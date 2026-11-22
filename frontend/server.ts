import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Chess, type Move } from 'chess.js';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type TelemetryLevel = 'INFO' | 'WARNING' | 'ERROR';
type TelemetryComponent =
  | 'api'
  | 'auth'
  | 'service'
  | 'orchestration'
  | 'storage'
  | 'engine'
  | 'stockfish'
  | 'maia'
  | 'voice'
  | 'startup';

interface TelemetryLogEntry {
  id: string;
  timestamp: string;
  level: TelemetryLevel;
  request_id: string;
  message: string;
  formatted: string;
  component: TelemetryComponent;
  method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number;
}

interface UserSession {
  user_id: string;
  username: string;
  email?: string;
  created_at: string;
  games_played: number;
}

interface MoveRecord {
  ply: number;
  san: string;
  uci: string;
  from: string;
  to: string;
  color: 'white' | 'black';
  piece: string;
  captured?: string;
  fen: string;
  timestamp: string;
  engine?: string;
}

interface EngineEvalSnapshot {
  evaluation: number | null;
  mate: number | null;
  bestmove: string | null;
  depth: number | null;
  source: string;
}

interface StoredGame {
  game_id: string;
  owner_id: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  opponent: 'stockfish' | 'maia' | 'human';
  player_color: 'white' | 'black';
  starter_mode: 'random' | 'white' | 'black';
  starter_note: string;
  chess: Chess;
  moves: MoveRecord[];
  captured: {
    white: string[];
    black: string[];
  };
  last_move: { from: string; to: string } | null;
  engine_eval: EngineEvalSnapshot | null;
}

interface AnalysisMistake {
  ply: number;
  move: string;
  severity: 'inaccuracy' | 'mistake' | 'blunder';
  note: string;
}

interface StoredAnalysisJob {
  job_id: string;
  game_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: {
    summary: string;
    mistakes: AnalysisMistake[];
    recommendations: string[];
  };
}

// ============================================================================
// Telemetry Engine — mirrors app/telemetry.py RequestIdFilter & Formatter:
// "%(asctime)s | %(levelname)s | request_id=%(request_id)s | %(message)s"
// ============================================================================

const MAX_LOGS = 350;
const telemetryLogs: TelemetryLogEntry[] = [];
const sseClients = new Set<Response>();
const startedAt = Date.now();

const aiUsage = {
  usage_date: new Date().toISOString().slice(0, 10),
  request_count: 0,
  total_cost: 0,
  input_tokens: 0,
  output_tokens: 0,
  daily_ai_request_limit: 100,
  daily_ai_budget: 1.0,
  total_latency_ms: 0,
  total_http_requests: 0,
  error_count: 0,
};

function formatPythonAsctime(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss},${ms}`;
}

function emitTelemetry(
  level: TelemetryLevel,
  message: string,
  requestId = '-',
  meta?: {
    component?: TelemetryComponent;
    method?: string;
    path?: string;
    status_code?: number;
    duration_ms?: number;
  },
): TelemetryLogEntry {
  const now = new Date();
  const timestamp = formatPythonAsctime(now);
  const reqId = requestId || '-';
  const formatted = `${timestamp} | ${level} | request_id=${reqId} | ${message}`;

  const entry: TelemetryLogEntry = {
    id: crypto.randomUUID(),
    timestamp,
    level,
    request_id: reqId,
    message,
    formatted,
    component: meta?.component ?? 'api',
    method: meta?.method,
    path: meta?.path,
    status_code: meta?.status_code,
    duration_ms: meta?.duration_ms,
  };

  telemetryLogs.push(entry);
  if (telemetryLogs.length > MAX_LOGS) {
    telemetryLogs.shift();
  }

  const payload = JSON.stringify(entry);
  for (const client of sseClients) {
    client.write(`data: ${payload}\n\n`);
  }

  return entry;
}

function getUsageSnapshot() {
  const today = new Date().toISOString().slice(0, 10);
  if (aiUsage.usage_date !== today) {
    aiUsage.usage_date = today;
    aiUsage.request_count = 0;
    aiUsage.total_cost = 0;
    aiUsage.input_tokens = 0;
    aiUsage.output_tokens = 0;
    aiUsage.total_latency_ms = 0;
  }
  return {
    usage_date: aiUsage.usage_date,
    request_count: aiUsage.request_count,
    total_cost: Number(aiUsage.total_cost.toFixed(6)),
    input_tokens: aiUsage.input_tokens,
    output_tokens: aiUsage.output_tokens,
    daily_ai_request_limit: aiUsage.daily_ai_request_limit,
    daily_ai_budget: aiUsage.daily_ai_budget,
    avg_latency_ms:
      aiUsage.request_count > 0
        ? Math.round(aiUsage.total_latency_ms / aiUsage.request_count)
        : 0,
    total_http_requests: aiUsage.total_http_requests,
    error_count: aiUsage.error_count,
  };
}

// ============================================================================
// Lightweight Session Store (No Firebase required)
// ============================================================================

const sessions = new Map<string, UserSession>();
const COOKIE_NAME = 'chessmind_sid';

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      map[k] = decodeURIComponent(v);
    }
  }
  return map;
}

function getSessionFromRequest(req: Request): UserSession | null {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[COOKIE_NAME];
  if (!sid) return null;
  return sessions.get(sid) ?? null;
}

// ============================================================================
// Chess Engines: Stockfish API + Maia Chess Human-Elo Policy + Local Fallback
// ============================================================================

const games = new Map<string, StoredGame>();
const analysisJobs = new Map<string, StoredAnalysisJob>();
let gameCounter = 0;
let jobCounter = 0;

const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

function evaluateBoardMaterial(chess: Chess): number {
  const board = chess.board();
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (!sq) continue;
      const val = PIECE_VALUES[sq.type] ?? 0;
      const centerBonus =
        (r === 3 || r === 4) && (c === 3 || c === 4)
          ? 25
          : r >= 2 && r <= 5 && c >= 2 && c <= 5
            ? 10
            : 0;
      const total = val + centerBonus;
      score += sq.color === 'w' ? total : -total;
    }
  }
  return score;
}

function chooseLocalFallbackMove(
  chess: Chess,
  level: StoredGame['level'],
): { move: Move; scoreCp: number } | null {
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) return null;

  const aiIsWhite = chess.turn() === 'w';
  const scored: Array<{ move: Move; score: number }> = [];

  for (const move of legalMoves) {
    chess.move(move);
    let score = evaluateBoardMaterial(chess);
    if (chess.isCheckmate()) {
      score = aiIsWhite ? 100000 : -100000;
    } else if (chess.isCheck()) {
      score += aiIsWhite ? 45 : -45;
    }

    if (level === 'advanced') {
      const replies = chess.moves({ verbose: true });
      if (replies.length > 0) {
        let worstReply = aiIsWhite ? Infinity : -Infinity;
        for (const r of replies.slice(0, 20)) {
          chess.move(r);
          const replyScore = evaluateBoardMaterial(chess);
          chess.undo();
          if (aiIsWhite) {
            if (replyScore < worstReply) worstReply = replyScore;
          } else {
            if (replyScore > worstReply) worstReply = replyScore;
          }
        }
        score = worstReply;
      }
    }
    chess.undo();
    scored.push({ move, score });
  }

  scored.sort((a, b) => (aiIsWhite ? b.score - a.score : a.score - b.score));

  if (level === 'beginner') {
    const pool = scored.slice(0, Math.min(5, scored.length));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return { move: pick.move, scoreCp: pick.score };
  }

  const bestScore = scored[0].score;
  const tied = scored.filter((s) => s.score === bestScore);
  const pick = tied[Math.floor(Math.random() * tied.length)];
  return { move: pick.move, scoreCp: pick.score };
}

function uciToMoveObj(chess: Chess, uci: string): Move | null {
  if (!uci || uci.length < 4) return null;
  const from = uci.slice(0, 2).toLowerCase();
  const to = uci.slice(2, 4).toLowerCase();
  const promotion = uci.length >= 5 ? uci[4].toLowerCase() : undefined;
  const legal = chess.moves({ verbose: true });
  return (
    legal.find(
      (m) => m.from === from && m.to === to && (!promotion || m.promotion === promotion),
    ) ?? null
  );
}

async function queryStockfishApi(
  fen: string,
  depth: number,
  requestId: string,
): Promise<EngineEvalSnapshot> {
  const start = Date.now();

  // 1. Primary: stockfish.online REST API
  try {
    const url = `https://stockfish.online/api/s/v2.php?fen=${encodeURIComponent(fen)}&depth=${depth}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const data = (await res.json()) as {
        success?: boolean;
        evaluation?: number | null;
        mate?: number | null;
        bestmove?: string;
      };
      if (data.success && data.bestmove) {
        const match = data.bestmove.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/i);
        const uci = match ? match[1].toLowerCase() : null;
        const duration = Date.now() - start;
        emitTelemetry(
          'INFO',
          `Stockfish API (stockfish.online) depth=${depth} bestmove=${uci ?? '-'} eval=${data.evaluation ?? 'mate'} (${duration}ms)`,
          requestId,
          { component: 'stockfish', duration_ms: duration },
        );
        return {
          evaluation: typeof data.evaluation === 'number' ? data.evaluation : null,
          mate: typeof data.mate === 'number' ? data.mate : null,
          bestmove: uci,
          depth,
          source: 'stockfish.online',
        };
      }
    }
  } catch (err) {
    emitTelemetry(
      'WARNING',
      `stockfish.online unreachable, trying chess-api.com: ${err instanceof Error ? err.message : 'timeout'}`,
      requestId,
      { component: 'stockfish' },
    );
  }

  // 2. Secondary: chess-api.com (Stockfish 18 REST API)
  try {
    const res = await fetch('https://chess-api.com/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, depth }),
      signal: AbortSignal.timeout(3500),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        move?: string;
        eval?: number;
        mate?: number | null;
        depth?: number;
      };
      if (data.move) {
        const duration = Date.now() - start;
        emitTelemetry(
          'INFO',
          `Stockfish 18 API (chess-api.com) depth=${data.depth ?? depth} bestmove=${data.move} eval=${data.eval ?? '-'} (${duration}ms)`,
          requestId,
          { component: 'stockfish', duration_ms: duration },
        );
        return {
          evaluation: typeof data.eval === 'number' ? data.eval : null,
          mate: typeof data.mate === 'number' ? data.mate : null,
          bestmove: data.move.toLowerCase(),
          depth: data.depth ?? depth,
          source: 'chess-api.com',
        };
      }
    }
  } catch {
    // Fall through to local fallback
  }

  // 3. Deterministic Local Minimax Fallback
  const temp = new Chess(fen);
  const local = chooseLocalFallbackMove(temp, depth >= 12 ? 'advanced' : 'intermediate');
  const duration = Date.now() - start;
  emitTelemetry(
    'WARNING',
    `Stockfish remote APIs unavailable, used local fallback (${duration}ms)`,
    requestId,
    { component: 'stockfish', duration_ms: duration },
  );
  return {
    evaluation: local ? Number((local.scoreCp / 100).toFixed(2)) : 0,
    mate: null,
    bestmove: local ? `${local.move.from}${local.move.to}${local.move.promotion ?? ''}` : null,
    depth: 2,
    source: 'local-fallback',
  };
}

async function queryMaiaMove(
  chess: Chess,
  level: StoredGame['level'],
  requestId: string,
): Promise<{ move: Move; elo: number; evalSnapshot: EngineEvalSnapshot } | null> {
  const start = Date.now();
  const elo = level === 'beginner' ? 1100 : level === 'intermediate' ? 1500 : 1900;
  const fen = chess.fen();
  const legal = chess.moves({ verbose: true });
  if (legal.length === 0) return null;

  // Query Lichess Cloud Eval Multi-PV to obtain candidate lines, then apply Maia human-Elo softmax sampling
  let candidates: Array<{ uci: string; cp: number }> = [];
  let source = `maia-${elo}-policy`;

  try {
    const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2800) });
    if (res.ok) {
      const data = (await res.json()) as {
        pvs?: Array<{ moves?: string; cp?: number; mate?: number }>;
      };
      if (Array.isArray(data.pvs) && data.pvs.length > 0) {
        candidates = data.pvs
          .map((pv) => {
            const firstMove = pv.moves?.split(' ')[0] ?? '';
            const cp =
              typeof pv.cp === 'number'
                ? pv.cp
                : typeof pv.mate === 'number'
                  ? pv.mate > 0
                    ? 9000
                    : -9000
                  : 0;
            return { uci: firstMove, cp };
          })
          .filter((c) => c.uci.length >= 4);
        source = `maia-${elo}+lichess-pv`;
      }
    }
  } catch {
    // Ignore cloud-eval miss and use local candidate scoring
  }

  // Fallback / enrichment with local human-oriented scoring across legal moves
  if (candidates.length === 0) {
    const aiIsWhite = chess.turn() === 'w';
    const localScored: Array<{ uci: string; cp: number }> = [];
    for (const m of legal) {
      chess.move(m);
      let cp = evaluateBoardMaterial(chess);
      if (chess.isCheckmate()) cp = aiIsWhite ? 100000 : -100000;
      else if (chess.isCheck()) cp += aiIsWhite ? 35 : -35;
      // Slight preference for natural pawn development / captures (typical human Maia bias)
      if (m.captured) cp += aiIsWhite ? 18 : -18;
      if (['e4', 'd4', 'e5', 'd5', 'c4', 'c5', 'f3', 'c3', 'f6', 'c6'].includes(m.to)) {
        cp += aiIsWhite ? 14 : -14;
      }
      chess.undo();
      localScored.push({
        uci: `${m.from}${m.to}${m.promotion ?? ''}`,
        cp: aiIsWhite ? cp : -cp,
      });
    }
    localScored.sort((a, b) => b.cp - a.cp);
    candidates = localScored.slice(0, 5);
  } else {
    const aiIsWhite = chess.turn() === 'w';
    candidates = candidates
      .map((c) => ({ uci: c.uci, cp: aiIsWhite ? c.cp : -c.cp }))
      .sort((a, b) => b.cp - a.cp);
  }

  // Maia Elo temperature: 1100 picks broadly from top 4 human candidates, 1500 from top 3, 1900 mostly top 1-2
  const maxPool = elo === 1100 ? 4 : elo === 1500 ? 3 : 2;
  const pool = candidates.slice(0, Math.min(maxPool, candidates.length));
  const temperature = elo === 1100 ? 180 : elo === 1500 ? 90 : 35;
  const bestCp = pool[0].cp;
  const weights = pool.map((c) => Math.exp((c.cp - bestCp) / temperature));
  const sumW = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sumW;
  let chosen = pool[0];
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      chosen = pool[i];
      break;
    }
  }

  const move = uciToMoveObj(chess, chosen.uci) ?? legal[0];
  const duration = Date.now() - start;
  emitTelemetry(
    'INFO',
    `Maia-${elo} (${source}) chose ${move.san} (${move.from}${move.to}) (${duration}ms)`,
    requestId,
    { component: 'maia', duration_ms: duration },
  );

  return {
    move,
    elo,
    evalSnapshot: {
      evaluation: Number(((chess.turn() === 'w' ? chosen.cp : -chosen.cp) / 100).toFixed(2)),
      mate: null,
      bestmove: `${move.from}${move.to}${move.promotion ?? ''}`,
      depth: null,
      source,
    },
  };
}

async function computeEngineReply(
  game: StoredGame,
  requestId: string,
): Promise<{ move: Move; engineLabel: string; evalSnapshot: EngineEvalSnapshot } | null> {
  if (game.opponent === 'human' || game.chess.isGameOver()) return null;

  if (game.opponent === 'stockfish') {
    const depth = game.level === 'beginner' ? 3 : game.level === 'intermediate' ? 8 : 14;
    const sf = await queryStockfishApi(game.chess.fen(), depth, requestId);

    // Beginner Stockfish occasionally takes 2nd-best or slightly softer line if available
    let move = sf.bestmove ? uciToMoveObj(game.chess, sf.bestmove) : null;
    if (!move) {
      const fb = chooseLocalFallbackMove(game.chess, game.level);
      if (fb) move = fb.move;
    }
    if (!move) return null;

    return {
      move,
      engineLabel: `Stockfish (${sf.source}, d=${sf.depth ?? depth})`,
      evalSnapshot: sf,
    };
  }

  // Maia Chess
  const maia = await queryMaiaMove(game.chess, game.level, requestId);
  if (!maia) return null;
  return {
    move: maia.move,
    engineLabel: `Maia-${maia.elo}`,
    evalSnapshot: maia.evalSnapshot,
  };
}

function serializeGame(game: StoredGame) {
  const { chess } = game;
  let status: 'active' | 'checkmate' | 'stalemate' | 'draw' = 'active';
  let winner: 'white' | 'black' | 'draw' | null = null;

  if (chess.isCheckmate()) {
    status = 'checkmate';
    winner = chess.turn() === 'w' ? 'black' : 'white';
  } else if (chess.isStalemate()) {
    status = 'stalemate';
    winner = 'draw';
  } else if (chess.isDraw()) {
    status = 'draw';
    winner = 'draw';
  }

  return {
    game_id: game.game_id,
    status,
    level: game.level,
    opponent: game.opponent,
    player_color: game.player_color,
    starter_mode: game.starter_mode,
    starter_note: game.starter_note,
    current_turn: chess.turn() === 'w' ? ('white' as const) : ('black' as const),
    fen: chess.fen(),
    is_check: chess.isCheck(),
    is_checkmate: chess.isCheckmate(),
    is_draw: chess.isDraw() || chess.isStalemate(),
    winner,
    moves: game.moves,
    captured: game.captured,
    last_move: game.last_move,
    engine_eval: game.engine_eval,
  };
}

function recordMoveOnGame(game: StoredGame, move: Move, engine?: string) {
  const color: 'white' | 'black' = move.color === 'w' ? 'white' : 'black';
  if (move.captured) {
    game.captured[color].push(move.captured);
  }
  const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
  game.last_move = { from: move.from, to: move.to };
  game.moves.push({
    ply: game.moves.length + 1,
    san: move.san,
    uci,
    from: move.from,
    to: move.to,
    color,
    piece: move.piece,
    captured: move.captured,
    fen: game.chess.fen(),
    timestamp: new Date().toISOString(),
    engine,
  });
}

// ============================================================================
// AI Coach (Gemini Server-Side Text + Voice STT/TTS + Fallback)
// ============================================================================

const rawGeminiKey = process.env.GEMINI_API_KEY?.trim() || '';
const geminiApiKey =
  rawGeminiKey && rawGeminiKey !== 'MY_GEMINI_API_KEY' ? rawGeminiKey : '';
const aiClient = geminiApiKey
  ? new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

function buildFallbackCoachAnswer(
  question: string,
  chess: Chess,
  stockfishHint?: EngineEvalSnapshot | null,
): {
  answer: string;
  suggestion: string;
  has_enough_data: boolean;
  missing_information: string[];
} {
  const turnLabel = chess.turn() === 'w' ? 'білих' : 'чорних';
  const legalMoves = chess.moves({ verbose: true });
  const material = evaluateBoardMaterial(chess);
  const materialText =
    Math.abs(material) < 50
      ? 'Матеріальний баланс приблизно рівний'
      : material > 0
        ? `Білі мають перевагу приблизно у ${(material / 100).toFixed(1)} пішака`
        : `Чорні мають перевагу приблизно у ${(Math.abs(material) / 100).toFixed(1)} пішака`;

  const checks = legalMoves.filter((m) => m.san.includes('+'));
  const captures = legalMoves.filter((m) => Boolean(m.captured));
  const centerMoves = legalMoves.filter((m) =>
    ['e4', 'd4', 'e5', 'd5', 'c4', 'c5', 'f3', 'c3', 'f6', 'c6'].includes(m.to),
  );

  const recommended = checks[0] ?? captures[0] ?? centerMoves[0] ?? legalMoves[0];
  const sfNote =
    stockfishHint?.bestmove
      ? ` Stockfish пропонує ${stockfishHint.bestmove} (оцінка: ${
          stockfishHint.mate !== null
            ? `мат у ${stockfishHint.mate}`
            : stockfishHint.evaluation !== null
              ? `${stockfishHint.evaluation > 0 ? '+' : ''}${stockfishHint.evaluation}`
              : '0.0'
        }).`
      : '';

  const lowerQ = question.toLowerCase();

  if (chess.isCheckmate()) {
    return {
      answer: `Партію завершено: на дошці мат. Сторона на ході (${turnLabel}) не має жодного легального захисту короля.`,
      suggestion: 'Розпочніть нову партію або запустіть повний аналіз помилок.',
      has_enough_data: true,
      missing_information: [],
    };
  }

  if (lowerQ.includes('не можу') || lowerQ.includes('правил') || lowerQ.includes('чому')) {
    return {
      answer: `Зараз черга ${turnLabel}, доступно ${legalMoves.length} легальних ходів.${
        chess.isCheck() ? ' Король перебуває під шахом — дозволені лише ходи, що знімають шах.' : ''
      } Фігура не може залишати свого короля під боєм.${sfNote}`,
      suggestion: recommended
        ? `Перевірте підсвічені поля на 3D-дошці або розгляньте хід ${recommended.san} (${recommended.from}→${recommended.to}).`
        : 'Оберіть іншу фігуру з підсвіченими легальними полями.',
      has_enough_data: true,
      missing_information: [],
    };
  }

  return {
    answer: `Зараз хід ${turnLabel}. ${materialText}. У позиції є ${legalMoves.length} легальних продовжень${
      captures.length > 0 ? `, серед них ${captures.length} взяттів` : ''
    }${checks.length > 0 ? ` та ${checks.length} шахів` : ''}.${sfNote}`,
    suggestion: stockfishHint?.bestmove
      ? `Найсильніший хід за оцінкою рушія — ${stockfishHint.bestmove}.`
      : recommended
        ? `Зверніть увагу на хід ${recommended.san} (${recommended.from}→${recommended.to}) для контролю центру.`
        : 'Розвивайте легкі фігури ближче до центру та подбайте про рокіровку.',
    has_enough_data: true,
    missing_information: [],
  };
}

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
app.use(express.json({ limit: '12mb' }));

// Request ID + HTTP Telemetry Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  if (req.path.startsWith('/api/') || req.path === '/health') {
    aiUsage.total_http_requests += 1;
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      if (req.path !== '/api/telemetry/stream' && req.path !== '/api/telemetry/logs') {
        const lvl: TelemetryLevel =
          res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARNING' : 'INFO';
        if (res.statusCode >= 400) {
          aiUsage.error_count += 1;
        }
        emitTelemetry(
          lvl,
          `${req.method} ${req.path} -> ${res.statusCode} (${durationMs}ms)`,
          requestId,
          {
            component: 'api',
            method: req.method,
            path: req.path,
            status_code: res.statusCode,
            duration_ms: durationMs,
          },
        );
      }
    });
  }

  next();
});

emitTelemetry(
  'INFO',
  'ChessMind started (Stockfish API + Maia Chess + Gemini Voice/Text + telemetry.py)',
  '-',
  { component: 'startup' },
);

// ---- Auth Routes ----
app.get('/api/auth/me', (req: Request, res: Response) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.json({ authenticated: false, user: null });
    return;
  }
  res.json({ authenticated: true, user: session });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const requestId = String(res.locals.requestId);
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';

  if (username.length < 2 || username.length > 40) {
    res.status(422).json({
      error: {
        kind: 'validation_error',
        message: 'Імʼя гравця повинно містити від 2 до 40 символів.',
        retryable: false,
        request_id: requestId,
      },
    });
    return;
  }

  const sid = crypto.randomUUID();
  const user: UserSession = {
    user_id: `usr-${sid.slice(0, 8)}`,
    username,
    email: email || undefined,
    created_at: new Date().toISOString(),
    games_played: 0,
  };
  sessions.set(sid, user);

  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );

  emitTelemetry('INFO', `Player signed in: ${user.username} (${user.user_id})`, requestId, {
    component: 'auth',
  });

  res.json({ authenticated: true, user });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const requestId = String(res.locals.requestId);
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[COOKIE_NAME];
  if (sid) {
    const user = sessions.get(sid);
    sessions.delete(sid);
    emitTelemetry('INFO', `Player signed out: ${user?.username ?? sid}`, requestId, {
      component: 'auth',
    });
  }
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ authenticated: false, user: null });
});

// ---- Health ----
app.get('/health', (_req: Request, res: Response) => {
  const requestId = String(res.locals.requestId);
  emitTelemetry('INFO', 'Health check requested', requestId, { component: 'api' });
  res.json({
    status: 'ok',
    version: '0.2.0',
    provider: aiClient ? 'gemini' : 'mock',
    model: aiClient ? 'gemini-4-hydrogen' : 'chessmind-mock',
    mode: aiClient ? 'live' : 'mock',
    storage: 'ok',
    extra: {
      chess_engine: 'chess.js',
      stockfish_api: 'stockfish.online / chess-api.com',
      maia_engine: 'maia-1100/1500/1900 (lichess-pv)',
      voice_models: 'gemini-3.5-transcribe + gemini-3.8-flash-lite-tts',
    },
    uptime_s: Math.floor((Date.now() - startedAt) / 1000),
  });
});

// ---- Telemetry ----
app.get('/api/telemetry/logs', (_req: Request, res: Response) => {
  res.json({
    logs: telemetryLogs,
    usage: getUsageSnapshot(),
  });
});

app.delete('/api/telemetry/logs', (_req: Request, res: Response) => {
  telemetryLogs.length = 0;
  emitTelemetry('INFO', 'Telemetry log buffer cleared by operator', String(res.locals.requestId), {
    component: 'storage',
  });
  res.json({ cleared: true, logs: telemetryLogs, usage: getUsageSnapshot() });
});

app.get('/api/telemetry/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// ---- Games (with Stockfish / Maia + Random First-Player Draw) ----
app.post('/api/games', async (req: Request, res: Response) => {
  const requestId = String(res.locals.requestId);
  const session = getSessionFromRequest(req);
  const body = req.body ?? {};

  const level: StoredGame['level'] = ['beginner', 'intermediate', 'advanced'].includes(body.level)
    ? body.level
    : 'intermediate';
  const opponent: StoredGame['opponent'] = ['stockfish', 'maia', 'human'].includes(body.opponent)
    ? body.opponent
    : 'stockfish';
  const starterMode: StoredGame['starter_mode'] = ['random', 'white', 'black'].includes(
    body.starter_mode,
  )
    ? body.starter_mode
    : 'random';

  let playerColor: 'white' | 'black' = 'white';
  if (starterMode === 'random') {
    playerColor = crypto.randomInt(0, 2) === 0 ? 'white' : 'black';
  } else {
    playerColor = starterMode;
  }

  const opponentLabel =
    opponent === 'stockfish' ? 'Stockfish' : opponent === 'maia' ? 'Maia Chess' : 'Гравець 2';

  const starterNote =
    opponent === 'human'
      ? 'Локальна гра: першими завжди ходять Білі.'
      : starterMode === 'random'
        ? playerColor === 'white'
          ? `Жереб: ви ходите першим (Білі) · ${opponentLabel} грає Чорними`
          : `Жереб: першим ходить ${opponentLabel} (Білі) · Ви граєте Чорними`
        : playerColor === 'white'
          ? `Ви граєте Білими (ходите першим) · ${opponentLabel} грає Чорними`
          : `Першим ходить ${opponentLabel} (Білі) · Ви граєте Чорними`;

  gameCounter += 1;
  const gameId = `game-${String(gameCounter).padStart(3, '0')}`;
  const chess = new Chess();

  const game: StoredGame = {
    game_id: gameId,
    owner_id: session?.user_id ?? 'guest',
    level,
    opponent,
    player_color: playerColor,
    starter_mode: starterMode,
    starter_note: starterNote,
    chess,
    moves: [],
    captured: { white: [], black: [] },
    last_move: null,
    engine_eval: null,
  };
  games.set(gameId, game);

  if (session) {
    session.games_played += 1;
  }

  emitTelemetry(
    'INFO',
    `Created ${gameId} for ${session?.username ?? 'guest'}: opponent=${opponent} level=${level} starter_mode=${starterMode} -> player_color=${playerColor}`,
    requestId,
    { component: 'storage' },
  );

  // If the random draw gave White (first move) to Stockfish or Maia, compute opening move immediately
  if (opponent !== 'human' && playerColor === 'black') {
    const reply = await computeEngineReply(game, requestId);
    if (reply) {
      game.chess.move(reply.move);
      recordMoveOnGame(game, reply.move, reply.engineLabel);
      game.engine_eval = reply.evalSnapshot;
    }
  }

  res.status(200).json(serializeGame(game));
});

app.get('/api/games/:gameId', (req: Request, res: Response) => {
  const requestId = String(res.locals.requestId);
  const game = games.get(String(req.params.gameId));
  if (!game) {
    emitTelemetry('WARNING', `Game not found: ${req.params.gameId}`, requestId, {
      component: 'storage',
    });
    res.status(404).json({
      error: {
        kind: 'game_not_found',
        message: 'Партію не знайдено.',
        retryable: false,
        request_id: requestId,
      },
    });
    return;
  }
  res.json(serializeGame(game));
});

app.post('/api/games/:gameId/moves', async (req: Request, res: Response) => {
  const requestId = String(res.locals.requestId);
  const game = games.get(String(req.params.gameId));
  if (!game) {
    emitTelemetry('WARNING', `Move rejected: game ${req.params.gameId} not found`, requestId, {
      component: 'engine',
    });
    res.status(404).json({
      error: {
        kind: 'game_not_found',
        message: 'Партію не знайдено.',
        retryable: false,
        request_id: requestId,
      },
    });
    return;
  }

  const rawMove = typeof req.body?.move === 'string' ? req.body.move.trim() : '';
  if (!rawMove) {
    res.status(422).json({
      error: {
        kind: 'validation_error',
        message: 'Поле move є обовʼязковим.',
        retryable: false,
        request_id: requestId,
      },
    });
    return;
  }

  // Enforce player turn color when playing against Stockfish or Maia
  const turnColor = game.chess.turn() === 'w' ? 'white' : 'black';
  if (game.opponent !== 'human' && turnColor !== game.player_color) {
    emitTelemetry('WARNING', `Out-of-turn move attempted by player (${turnColor})`, requestId, {
      component: 'engine',
    });
    res.status(409).json({
      error: {
        kind: 'not_your_turn',
        message: 'Зараз черга ходу суперника.',
        retryable: false,
        request_id: requestId,
      },
    });
    return;
  }

  let appliedMove: Move | null = null;
  try {
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(rawMove)) {
      const from = rawMove.slice(0, 2).toLowerCase();
      const to = rawMove.slice(2, 4).toLowerCase();
      const promotion = rawMove.length === 5 ? rawMove[4].toLowerCase() : undefined;
      appliedMove = game.chess.move({ from, to, promotion });
    } else {
      appliedMove = game.chess.move(rawMove);
    }
  } catch {
    appliedMove = null;
  }

  if (!appliedMove) {
    emitTelemetry('WARNING', `Illegal move rejected: "${rawMove}" in ${game.game_id}`, requestId, {
      component: 'engine',
    });
    res.status(400).json({
      error: {
        kind: 'invalid_move',
        message: 'Неможливо виконати цей шаховий хід.',
        retryable: false,
        request_id: requestId,
      },
    });
    return;
  }

  recordMoveOnGame(game, appliedMove, 'player');
  emitTelemetry(
    'INFO',
    `Player move validated: ${appliedMove.san} (${appliedMove.from}${appliedMove.to})`,
    requestId,
    { component: 'engine' },
  );

  let computerMoveUci: string | null = null;
  let computerEngine: string | null = null;

  if (game.opponent !== 'human' && !game.chess.isGameOver()) {
    const reply = await computeEngineReply(game, requestId);
    if (reply) {
      game.chess.move(reply.move);
      recordMoveOnGame(game, reply.move, reply.engineLabel);
      game.engine_eval = reply.evalSnapshot;
      computerMoveUci = `${reply.move.from}${reply.move.to}${reply.move.promotion ?? ''}`;
      computerEngine = reply.engineLabel;
    }
  }

  res.json({
    ...serializeGame(game),
    move: `${appliedMove.from}${appliedMove.to}${appliedMove.promotion ?? ''}`,
    computer_move: computerMoveUci,
    computer_engine: computerEngine,
  });
});

// ---- Explicit Stockfish Evaluation Endpoint ----
app.post('/api/engine/evaluate', async (req: Request, res: Response) => {
  const requestId = String(res.locals.requestId);
  const gameId = typeof req.body?.game_id === 'string' ? req.body.game_id : '';
  const game = gameId ? games.get(gameId) : undefined;
  const fen =
    typeof req.body?.fen === 'string' && req.body.fen.includes('/')
      ? req.body.fen
      : game?.chess.fen() || new Chess().fen();
  const depth = Number(req.body?.depth) || 10;

  const evalSnapshot = await queryStockfishApi(fen, Math.min(Math.max(depth, 2), 15), requestId);
  if (game) {
    game.engine_eval = evalSnapshot;
  }
  res.json({ ...evalSnapshot, request_id: requestId });
});

// ---- Gemini Text Coach (/api/coach/explain) ----
app.post('/api/coach/explain', async (req: Request, res: Response) => {
  const requestId = String(res.locals.requestId);
  const start = Date.now();
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  const position = typeof req.body?.position === 'string' ? req.body.position.trim() : 'current';
  const gameId = typeof req.body?.game_id === 'string' ? req.body.game_id : null;
  const simulateError = req.body?.simulate_error;

  if (!question) {
    res.status(422).json({
      error: {
        kind: 'validation_error',
        message: 'Запитання до AI-тренера не може бути порожнім.',
        retryable: false,
        request_id: requestId,
      },
    });
    return;
  }

  emitTelemetry('INFO', 'API received assistant request', requestId, { component: 'api' });
  emitTelemetry('INFO', 'Chess service started', requestId, { component: 'service' });
  emitTelemetry('INFO', 'AI orchestration started', requestId, { component: 'orchestration' });

  if (simulateError === 'timeout') {
    emitTelemetry('ERROR', 'ProviderTimeoutError: AI provider timed out after 20s', requestId, {
      component: 'orchestration',
    });
    res.status(504).json({
      error: {
        kind: 'provider_timeout',
        message: 'Перевищено час очікування відповіді від AI-провайдера.',
        retryable: true,
        request_id: requestId,
      },
    });
    return;
  }
  if (simulateError === 'rate_limit') {
    emitTelemetry('ERROR', 'ProviderRateLimitError: 429 Too Many Requests', requestId, {
      component: 'orchestration',
    });
    res.status(429).json({
      error: {
        kind: 'rate_limit',
        message: 'Перевищено ліміт запитів до AI-провайдера.',
        retryable: true,
        request_id: requestId,
      },
    });
    return;
  }
  if (simulateError === 'unavailable') {
    emitTelemetry('ERROR', 'ProviderUnavailableError: Upstream provider unreachable', requestId, {
      component: 'orchestration',
    });
    res.status(503).json({
      error: {
        kind: 'provider_unavailable',
        message: 'AI-сервіс тимчасово недоступний.',
        retryable: true,
        request_id: requestId,
      },
    });
    return;
  }

  const game = gameId ? games.get(gameId) : undefined;
  const chess = new Chess();
  if (position && position !== 'current' && position.includes('/')) {
    try {
      chess.load(position);
    } catch {
      if (game) chess.load(game.chess.fen());
    }
  } else if (game) {
    chess.load(game.chess.fen());
  }

  const usage = getUsageSnapshot();
  if (usage.request_count >= usage.daily_ai_request_limit || usage.total_cost >= usage.daily_ai_budget) {
    emitTelemetry('ERROR', 'ProviderBudgetExceededError: daily AI limit reached', requestId, {
      component: 'storage',
    });
    res.status(429).json({
      error: {
        kind: 'budget_exceeded',
        message: 'Перевищено денний ліміт AI-запитів.',
        retryable: false,
        request_id: requestId,
      },
    });
    return;
  }

  // Ground coach response in live Stockfish evaluation
  const stockfishEval = await queryStockfishApi(chess.fen(), 8, requestId);
  if (game) {
    game.engine_eval = stockfishEval;
  }

  aiUsage.request_count += 1;

  let output = buildFallbackCoachAnswer(question, chess, stockfishEval);
  let providerName = 'mock';
  let modelName = 'chessmind-mock';
  let inputTokens = Math.max(42, Math.round((question.length + chess.fen().length) / 3));
  let outputTokens = Math.max(48, Math.round((output.answer.length + output.suggestion.length) / 3));
  let cost = 0;

  if (aiClient) {
    try {
      const moveList = game ? game.moves.map((m) => m.san).join(' ') : '';
      const legalSample = chess
        .moves({ verbose: true })
        .slice(0, 14)
        .map((m) => `${m.san} (${m.from}${m.to})`)
        .join(', ');

      const prompt = [
        'Ти ChessMind — уважний українськомовний шаховий тренер.',
        `Поточний FEN: ${chess.fen()}`,
        `Черга ходу: ${chess.turn() === 'w' ? 'білі' : 'чорні'}`,
        game ? `Колір гравця: ${game.player_color === 'white' ? 'білі' : 'чорні'}` : '',
        `Історія ходів: ${moveList || 'початкова позиція'}`,
        `Оцінка Stockfish (${stockfishEval.source}): eval=${stockfishEval.evaluation ?? '-'} mate=${stockfishEval.mate ?? '-'} bestmove=${stockfishEval.bestmove ?? '-'}`,
        `Доступні легальні ходи (частина): ${legalSample || 'немає'}`,
        `Запитання гравця: ${question}`,
        'Відповідай коротко, чітко, по позиції та українською мовою.',
      ]
        .filter(Boolean)
        .join('\n');

      const aiPromise = aiClient.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              answer: { type: Type.STRING },
              suggestion: { type: Type.STRING },
              has_enough_data: { type: Type.BOOLEAN },
              missing_information: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['answer', 'suggestion', 'has_enough_data', 'missing_information'],
          },
        },
      });

      const aiRes = await Promise.race([
        aiPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini upstream timeout after 6000ms')), 6000),
        ),
      ]);

      const parsed = JSON.parse(aiRes.text || '{}');
      if (parsed.answer && parsed.suggestion) {
        output = {
          answer: String(parsed.answer),
          suggestion: String(parsed.suggestion),
          has_enough_data: Boolean(parsed.has_enough_data ?? true),
          missing_information: Array.isArray(parsed.missing_information)
            ? parsed.missing_information.map(String)
            : [],
        };
      }
      providerName = 'gemini';
      modelName = 'gemini-4-hydrogen';
      const usageMeta = aiRes.usageMetadata;
      if (usageMeta) {
        inputTokens = usageMeta.promptTokenCount ?? inputTokens;
        outputTokens = usageMeta.candidatesTokenCount ?? outputTokens;
      }
      cost = Number(((inputTokens * 0.0000001) + (outputTokens * 0.0000004)).toFixed(6));
    } catch (err) {
      emitTelemetry(
        'WARNING',
        `Gemini text call fell back to Stockfish+local analyzer: ${err instanceof Error ? err.message : 'unknown'}`,
        requestId,
        { component: 'orchestration' },
      );
    }
  }

  const latencyMs = Date.now() - start;
  aiUsage.input_tokens += inputTokens;
  aiUsage.output_tokens += outputTokens;
  aiUsage.total_cost += cost;
  aiUsage.total_latency_ms += latencyMs;

  emitTelemetry(
    'INFO',
    `AI orchestration completed (provider=${providerName}, tokens=${inputTokens + outputTokens}, latency=${latencyMs}ms)`,
    requestId,
    { component: 'orchestration' },
  );
  emitTelemetry('INFO', 'Chess service completed', requestId, { component: 'service' });
  emitTelemetry('INFO', 'API returned assistant response', requestId, { component: 'api' });

  res.json({
    ...output,
    request_id: requestId,
    provider: providerName,
    model: modelName,
    latency_ms: latencyMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost,
    stockfish_hint: stockfishEval.bestmove
      ? `${stockfishEval.bestmove} (${stockfishEval.evaluation ?? 'mate'})`
      : null,
  });
});

// ---- Gemini Voice Assistant: Speech-to-Text (/api/coach/transcribe) ----
app.post('/api/coach/transcribe', async (req: Request, res: Response) => {
  const requestId = String(res.locals.requestId);
  const start = Date.now();
  const audioBase64 = typeof req.body?.audio_base64 === 'string' ? req.body.audio_base64 : '';
  const mimeType = typeof req.body?.mime_type === 'string' ? req.body.mime_type : 'audio/webm';

  if (!audioBase64) {
    res.status(422).json({
      error: {
        kind: 'validation_error',
        message: 'Відсутні аудіодані для розпізнавання.',
        retryable: false,
        request_id: requestId,
      },
    });
    return;
  }

  emitTelemetry('INFO', `Voice STT received (${mimeType})`, requestId, { component: 'voice' });

  if (!aiClient) {
    const latencyMs = Date.now() - start;
    emitTelemetry(
      'WARNING',
      'GEMINI_API_KEY not configured for STT; returning browser fallback hint',
      requestId,
      { component: 'voice' },
    );
    res.json({
      text: 'Оціни поточну позицію та порадь найкращий хід',
      request_id: requestId,
      provider: 'fallback',
      model: 'local-stt-fallback',
      latency_ms: latencyMs,
    });
    return;
  }

  try {
    const sttPromise = aiClient.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: audioBase64,
            },
          },
          { text: 'Транскрибуй це голосове запитання про шахи українською мовою. Поверни лише текст запитання.' },
        ],
      },
    });

    const aiRes = await Promise.race([
      sttPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini STT timeout after 8000ms')), 8000),
      ),
    ]);

    const transcribed = (aiRes.text ?? '').trim();
    const latencyMs = Date.now() - start;
    emitTelemetry(
      'INFO',
      `Gemini STT transcribed voice query (${latencyMs}ms): "${transcribed.slice(0, 60)}"`,
      requestId,
      { component: 'voice', duration_ms: latencyMs },
    );

    res.json({
      text: transcribed || 'Оціни поточну позицію',
      request_id: requestId,
      provider: 'gemini',
      model: 'gemini-3.5-transcribe',
      latency_ms: latencyMs,
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    emitTelemetry(
      'WARNING',
      `Gemini STT error, using fallback: ${err instanceof Error ? err.message : 'unknown'}`,
      requestId,
      { component: 'voice' },
    );
    res.json({
      text: 'Оціни поточну позицію та порадь найкращий хід',
      request_id: requestId,
      provider: 'fallback',
      model: 'local-stt-fallback',
      latency_ms: latencyMs,
    });
  }
});

// ---- Gemini Voice Assistant: Text-to-Speech (/api/coach/speak) ----
app.post('/api/coach/speak', async (req: Request, res: Response) => {
  const requestId = String(res.locals.requestId);
  const start = Date.now();
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const voiceName = typeof req.body?.voice_name === 'string' ? req.body.voice_name : 'Kore';

  if (!text) {
    res.status(422).json({
      error: {
        kind: 'validation_error',
        message: 'Текст для озвучення не може бути порожнім.',
        retryable: false,
        request_id: requestId,
      },
    });
    return;
  }

  emitTelemetry('INFO', `Voice TTS synthesis requested (voice=${voiceName})`, requestId, {
    component: 'voice',
  });

  if (!aiClient) {
    const latencyMs = Date.now() - start;
    emitTelemetry(
      'INFO',
      'GEMINI_API_KEY not set — delegating TTS to browser SpeechSynthesis',
      requestId,
      { component: 'voice' },
    );
    res.json({
      audio_base64: null,
      mime_type: 'audio/wav',
      fallback_tts: true,
      text,
      request_id: requestId,
      provider: 'browser-speech-synthesis',
      model: 'web-speech-uk',
      latency_ms: latencyMs,
    });
    return;
  }

  try {
    const ttsPromise = aiClient.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text,
              speechMetadata: {
                style: 'Спокійний, впевнений та дружній шаховий тренер українською мовою',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const aiRes = await Promise.race([
      ttsPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini TTS timeout after 8000ms')), 8000),
      ),
    ]);

    const base64Audio =
      aiRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? null;
    const latencyMs = Date.now() - start;

    if (base64Audio) {
      emitTelemetry(
        'INFO',
        `Gemini TTS synthesized WAV audio (${Math.round((base64Audio.length * 3) / 4)} bytes, ${latencyMs}ms)`,
        requestId,
        { component: 'voice', duration_ms: latencyMs },
      );
      res.json({
        audio_base64: base64Audio,
        mime_type: 'audio/wav',
        fallback_tts: false,
        text,
        request_id: requestId,
        provider: 'gemini',
        model: 'gemini-3.8-flash-lite-tts',
        latency_ms: latencyMs,
      });
      return;
    }

    res.json({
      audio_base64: null,
      mime_type: 'audio/wav',
      fallback_tts: true,
      text,
      request_id: requestId,
      provider: 'browser-speech-synthesis',
      model: 'web-speech-uk',
      latency_ms: latencyMs,
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    emitTelemetry(
      'WARNING',
      `Gemini TTS error, using browser SpeechSynthesis fallback: ${err instanceof Error ? err.message : 'unknown'}`,
      requestId,
      { component: 'voice' },
    );
    res.json({
      audio_base64: null,
      mime_type: 'audio/wav',
      fallback_tts: true,
      text,
      request_id: requestId,
      provider: 'browser-speech-synthesis',
      model: 'web-speech-uk',
      latency_ms: latencyMs,
    });
  }
});

// ---- Game Analysis Jobs ----
app.post('/api/games/analyze', (req: Request, res: Response) => {
  const requestId = String(res.locals.requestId);
  const gameId = typeof req.body?.game_id === 'string' ? req.body.game_id : '';
  const game = games.get(gameId);

  if (!game) {
    res.status(404).json({
      error: {
        kind: 'game_not_found',
        message: 'Партію для аналізу не знайдено.',
        retryable: false,
        request_id: requestId,
      },
    });
    return;
  }

  jobCounter += 1;
  const jobId = `analysis-${String(jobCounter).padStart(3, '0')}`;
  const job: StoredAnalysisJob = {
    job_id: jobId,
    game_id: gameId,
    status: 'pending',
  };
  analysisJobs.set(jobId, job);

  emitTelemetry('INFO', `Queued game analysis job ${jobId} for ${gameId}`, requestId, {
    component: 'service',
  });

  setTimeout(() => {
    job.status = 'running';
    emitTelemetry('INFO', `Analysis job ${jobId} running (${game.moves.length} plies)`, requestId, {
      component: 'orchestration',
    });
  }, 220);

  setTimeout(() => {
    const mistakes: AnalysisMistake[] = [];
    let prevScore = 0;
    const replay = new Chess();

    for (const m of game.moves) {
      replay.move({
        from: m.from,
        to: m.to,
        promotion: m.uci.length === 5 ? m.uci[4] : undefined,
      });
      const currentScore = evaluateBoardMaterial(replay);
      const delta = m.color === 'white' ? currentScore - prevScore : prevScore - currentScore;
      if (delta <= -300) {
        mistakes.push({
          ply: m.ply,
          move: m.san,
          severity: 'blunder',
          note: `Втрата матеріалу (${(Math.abs(delta) / 100).toFixed(1)} пішака) після ходу ${m.san}.`,
        });
      } else if (delta <= -120) {
        mistakes.push({
          ply: m.ply,
          move: m.san,
          severity: 'mistake',
          note: `Неточність або послаблення позиції після ходу ${m.san}.`,
        });
      }
      prevScore = currentScore;
    }

    const totalMoves = game.moves.length;
    const summary =
      totalMoves === 0
        ? 'Партія ще у початковій позиції — зробіть кілька ходів для розбору.'
        : `Проаналізовано ${totalMoves} півходів. ${
            game.chess.isCheckmate()
              ? 'Зафіксовано мат.'
              : game.chess.isDraw()
                ? 'Партія завершилась унічию.'
                : 'Партія триває.'
          } Знайдено критичних епізодів: ${mistakes.length}.`;

    const recommendations = [
      totalMoves < 8
        ? 'Контролюйте центральні поля (e4, d4, e5, d5) та завершіть розвиток легких фігур.'
        : 'Перед кожним ходом перевіряйте незахищені фігури та можливі шахи суперника.',
      mistakes.length > 0
        ? `Перегляньте півхід №${mistakes[0].ply} (${mistakes[0].move}), щоб уникнути матеріальних втрат.`
        : 'Гру проведено стабільно без грубих матеріальних втрат.',
    ];

    job.status = 'completed';
    job.result = {
      summary,
      mistakes,
      recommendations,
    };

    emitTelemetry('INFO', `Analysis job ${jobId} completed`, requestId, {
      component: 'orchestration',
    });
  }, 650);

  res.status(202).json({
    job_id: jobId,
    game_id: gameId,
    status: 'pending',
  });
});

app.get('/api/games/analyze/:jobId', (req: Request, res: Response) => {
  const requestId = String(res.locals.requestId);
  const job = analysisJobs.get(String(req.params.jobId));
  if (!job) {
    res.status(404).json({
      error: {
        kind: 'job_not_found',
        message: 'Завдання аналізу не знайдено.',
        retryable: false,
        request_id: requestId,
      },
    });
    return;
  }
  res.json(job);
});

async function startServer() {
  const port = Number(process.env.PORT) || 3000;
  const distPath = path.resolve(__dirname, 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distPath);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`ChessMind 3D server running on http://0.0.0.0:${port}`);
  });
}

startServer();
