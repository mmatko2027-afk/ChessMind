import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { LogOut, Shuffle, Trophy } from 'lucide-react';
import { ChessBoard3D } from './components/chess3d/ChessBoard3D';
import { CoachPanel } from './components/panels/CoachPanel';
import { HistoryPanel } from './components/panels/HistoryPanel';
import { AdminPanel } from './components/panels/AdminPanel';
import { useGameWebSocket } from './hooks/useGameWebSocket';
import type { SelectedPieceInfo } from './utils/pieceGuides';
import type {
  AiUsageMetrics,
  CoachResponse,
  EngineEvalSnapshot,
  ErrorResponse,
  GameHistoryItem,
  GameLevel,
  GameStateResponse,
  MoveResponse,
  StarterMode,
  TelemetryLogEntry,
  UserSession,
} from './types/chessmind';

type SidebarTab = 'coach' | 'history' | 'admin';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const DEFAULT_USAGE: AiUsageMetrics = {
  usage_date: new Date().toISOString().slice(0, 10),
  request_count: 0,
  total_cost: 0,
  input_tokens: 0,
  output_tokens: 0,
  daily_ai_request_limit: 100,
  daily_ai_budget: 1.0,
  avg_latency_ms: 0,
  total_http_requests: 0,
  error_count: 0,
  active_model: 'gemini-4-hydrogen',
  primary_model: 'gemini-4-hydrogen',
  fallback_model: 'gemini-3.1-flash-lite',
  model_token_limit: 25000,
  fallback_triggered_count: 0,
  by_model: {},
};

const LEVEL_CARDS: Array<{ id: GameLevel; title: string; desc: string }> = [
  {
    id: 'beginner',
    title: 'Початківець',
    desc: 'Інтерактивні підказки про рух і взяття фігур під час гри.',
  },
  {
    id: 'intermediate',
    title: 'Середній',
    desc: 'Підлаштовується під ваш досвід і темп гри автоматично.',
  },
  {
    id: 'advanced',
    title: 'Високий',
    desc: 'Сильний суперник. Підказки лише за вашим запитом.',
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('coach');
  const [zenMode, setZenMode] = useState(false);

  // Auth state
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<UserSession | null>(null);
  const [loginName, setLoginName] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Match setup (difficulty only — engine is automatic)
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<GameLevel>('beginner');
  const [selectedStarter, setSelectedStarter] = useState<StarterMode>('random');
  const [creatingGame, setCreatingGame] = useState(false);

  // Active game & board state
  const [game, setGame] = useState<GameStateResponse | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [selectedPiece, setSelectedPiece] = useState<SelectedPieceInfo | null>(null);
  const [hintMove, setHintMove] = useState<{ from: string; to: string } | null>(null);
  const [gameOverDismissedForId, setGameOverDismissedForId] = useState<string | null>(null);

  // Coach & model fallback state
  const [coachResponse, setCoachResponse] = useState<CoachResponse | null>(null);
  const [coachError, setCoachError] = useState<ErrorResponse | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [autoFallback, setAutoFallback] = useState(true);

  // History state
  const [history, setHistory] = useState<GameHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [previewFen, setPreviewFen] = useState<string | null>(null);

  // Admin-only telemetry & tokens
  const [logs, setLogs] = useState<TelemetryLogEntry[]>([]);
  const [usage, setUsage] = useState<AiUsageMetrics>(DEFAULT_USAGE);
  const [sseConnected, setSseConnected] = useState(false);
  const [filterRequestId, setFilterRequestId] = useState('');

  // Notice banner
  const [bannerNotice, setBannerNotice] = useState<{
    kind: 'error' | 'info';
    text: string;
  } | null>(null);

  const initDoneRef = useRef(false);

  const showNotice = useCallback((kind: 'error' | 'info', text: string) => {
    setBannerNotice({ kind, text });
  }, []);

  useEffect(() => {
    if (!bannerNotice) return;
    const t = setTimeout(() => setBannerNotice(null), 4500);
    return () => clearTimeout(t);
  }, [bannerNotice]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/games/history');
      if (res.ok) {
        const data = (await res.json()) as { games?: GameHistoryItem[] };
        setHistory(data.games ?? []);
      }
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const refreshAdminTelemetry = useCallback(async () => {
    if (!user?.is_admin) return;
    try {
      const res = await fetch('/api/telemetry/logs');
      if (!res.ok) return;
      const data = await res.json();
      setLogs(data.logs ?? []);
      if (data.usage) setUsage(data.usage);
    } catch {
      // Ignore transient hiccup
    }
  }, [user?.is_admin]);

  const { wsConnected, sendMove } = useGameWebSocket({
    gameId: game?.game_id ?? null,
    onGameState: useCallback(
      (nextState) => {
        setGame((prev) => {
          if (
            prev &&
            prev.game_id === nextState.game_id &&
            nextState.moves.length < prev.moves.length
          ) {
            return prev;
          }
          return nextState;
        });
        setMoveBusy(false);
        setHintMove(null);
        fetchHistory();
      },
      [fetchHistory],
    ),
    onError: useCallback(
      (err) => {
        setMoveBusy(false);
        showNotice('error', err.message);
      },
      [showNotice],
    ),
  });

  // Bootstrap session check
  useEffect(() => {
    if (initDoneRef.current) return;
    initDoneRef.current = true;

    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = (await res.json()) as { authenticated: boolean; user: UserSession | null };
        if (data.authenticated && data.user) {
          setUser(data.user);
          setNewGameOpen(true);
          fetchHistory();
        }
      } finally {
        setAuthChecked(true);
      }
    })();
  }, [fetchHistory]);

  // Admin-only SSE log subscription
  useEffect(() => {
    if (!user?.is_admin) {
      setSseConnected(false);
      return;
    }

    refreshAdminTelemetry();
    const eventSource = new EventSource('/api/telemetry/stream');
    eventSource.onopen = () => setSseConnected(true);
    eventSource.onerror = () => setSseConnected(false);
    eventSource.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as TelemetryLogEntry;
        setLogs((prev) => {
          if (prev.some((l) => l.id === entry.id)) return prev;
          const next = [...prev, entry];
          return next.length > 350 ? next.slice(next.length - 350) : next;
        });
        refreshAdminTelemetry();
      } catch {
        // Ignore malformed event
      }
    };

    return () => {
      eventSource.close();
    };
  }, [user?.is_admin, refreshAdminTelemetry]);

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = loginName.trim();
    if (trimmed.length < 2) {
      setLoginError('Введіть імʼя гравця (мінімум 2 символи).');
      return;
    }
    setLoginBusy(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmed, email: loginEmail.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        setUser(data.user);
        setNewGameOpen(true);
        fetchHistory();
      } else if (data.error?.message) {
        setLoginError(data.error.message);
      }
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setGame(null);
    setPreviewFen(null);
    setActiveTab('coach');
    setNewGameOpen(false);
  };

  const createNewGame = useCallback(
    async (level: GameLevel, starterMode: StarterMode) => {
      setCreatingGame(true);
      try {
        const res = await fetch('/api/games', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level, starter_mode: starterMode }),
        });
        if (res.ok) {
          const data = (await res.json()) as GameStateResponse;
          setGame(data);
          setPreviewFen(null);
          setActiveTab('coach');
          setCoachResponse(null);
          setCoachError(null);
          setHintMove(null);
          setGameOverDismissedForId(null);
          showNotice('info', data.starter_note);
          fetchHistory();
        }
      } finally {
        setCreatingGame(false);
      }
    },
    [fetchHistory, showNotice],
  );

  const handleAttemptMove = useCallback(
    async (from: string, to: string, promotion?: string) => {
      if (!game || moveBusy || previewFen) return;
      setMoveBusy(true);
      setHintMove(null);
      const uci = `${from}${to}${promotion ?? ''}`;

      if (wsConnected && sendMove(uci)) {
        return;
      }

      try {
        const res = await fetch(`/api/games/${game.game_id}/moves`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ move: uci }),
        });
        const data = await res.json();
        if (res.ok) {
          setGame(data as MoveResponse);
          fetchHistory();
        } else if (data.error) {
          showNotice('error', data.error.message);
        }
      } finally {
        setMoveBusy(false);
      }
    },
    [game, moveBusy, previewFen, wsConnected, sendMove, fetchHistory, showNotice],
  );

  const handleAskCoach = useCallback(
    async (question: string): Promise<CoachResponse | null> => {
      setCoachLoading(true);
      setCoachError(null);
      try {
        const res = await fetch('/api/coach/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            game_id: game?.game_id ?? null,
            question,
            position: game?.fen ?? 'current',
            auto_fallback: autoFallback,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setCoachResponse(data as CoachResponse);
          refreshAdminTelemetry();
          return data as CoachResponse;
        } else {
          setCoachError(data as ErrorResponse);
          return null;
        }
      } finally {
        setCoachLoading(false);
      }
    },
    [game, autoFallback, refreshAdminTelemetry],
  );

  const handleRequestHint = useCallback(async () => {
    if (!game || game.status !== 'active') return;
    if (hintMove) {
      setHintMove(null);
      return;
    }
    const evalRes = await fetch('/api/engine/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: game.game_id, fen: game.fen, depth: 10 }),
    });
    if (evalRes.ok) {
      const snap = (await evalRes.json()) as EngineEvalSnapshot;
      setGame((prev) => (prev ? { ...prev, engine_eval: snap } : prev));
      if (snap.bestmove && snap.bestmove.length >= 4) {
        setHintMove({
          from: snap.bestmove.slice(0, 2),
          to: snap.bestmove.slice(2, 4),
        });
      }
    }
    await handleAskCoach('Дай коротку підказку, який хід зараз найкращий і чому.');
  }, [game, hintMove, handleAskCoach]);

  const handleClearLogs = useCallback(async () => {
    const res = await fetch('/api/telemetry/logs', { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs ?? []);
      if (data.usage) setUsage(data.usage);
    }
  }, []);

  const handleUpdateTokenLimit = useCallback(
    async (limit: number, resetPrimary?: boolean) => {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_token_limit: limit, reset_active_model: resetPrimary }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.usage) setUsage(data.usage);
        showNotice('info', 'Налаштування ліміту токенів оновлено.');
      }
    },
    [showNotice],
  );

  const tabs: Array<{ id: SidebarTab; label: string }> = [
    { id: 'coach', label: 'Партія' },
    { id: 'history', label: 'Історія' },
    ...(user?.is_admin ? ([{ id: 'admin', label: 'Адмін' }] as const) : []),
  ];

  const isGameOver = Boolean(game && game.status !== 'active');
  const showGameOverModal =
    isGameOver && game && gameOverDismissedForId !== game.game_id && !newGameOpen;

  const gameMistakes =
    game?.moves.filter(
      (m) => m.color === game.player_color && (m.quality === 'mistake' || m.quality === 'inaccuracy'),
    ).length ?? 0;
  const gameBlunders =
    game?.moves.filter((m) => m.color === game.player_color && m.quality === 'blunder').length ?? 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0B0E14] text-[#E6E9EF] overflow-hidden">
      {/* Minimalist 3-Zone Top Bar */}
      <header className="h-14 px-6 border-b border-white/[0.08] bg-[#0F141E] flex items-center justify-between gap-8 shrink-0">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setZenMode(false);
          }}
          className="flex items-center gap-2 text-lg font-bold tracking-tight text-white font-display whitespace-nowrap shrink-0"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-5 h-5 text-[#D4A359] shrink-0"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="12" cy="6.5" r="3" />
            <rect x="8.5" y="9.9" width="7" height="1.6" rx="0.8" />
            <path d="M9.6 11.9h4.8l1.7 5.6H7.9l1.7-5.6Z" />
            <rect x="6" y="18.2" width="12" height="2.6" rx="1" />
          </svg>
          <span>ChessMind</span>
        </a>

        <nav className="flex items-center gap-6 text-sm font-medium">
          {tabs.map((item) => {
            const isActive = !zenMode && activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setZenMode(false);
                  if (item.id !== 'history') {
                    setPreviewFen(null);
                  }
                  if (item.id === 'history') {
                    fetchHistory();
                  }
                }}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'border-[#D4A359] text-white'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setZenMode((v) => !v)}
            className={`hidden sm:inline-block py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              zenMode
                ? 'border-[#D4A359] text-white'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            3D-сцена
          </button>
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            disabled={!user}
            onClick={() => setNewGameOpen(true)}
            className="px-4 py-2 rounded-lg bg-[#D4A359] hover:bg-[#DFB26B] disabled:opacity-40 text-[#0B0E14] text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            Нова партія
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row relative overflow-hidden">
        {/* Primary 3D Chessboard Stage */}
        <section className="flex-1 min-w-0 min-h-0 relative overflow-hidden">
          <ChessBoard3D
            gameId={game?.game_id}
            fen={previewFen || game?.fen || INITIAL_FEN}
            currentTurn={game?.current_turn || 'white'}
            playerColor={game?.player_color || 'white'}
            opponent={game?.opponent || 'maia'}
            starterNote={previewFen ? 'Режим перегляду історії партії' : game?.starter_note}
            isCheck={!previewFen && (game?.is_check || false)}
            lastMove={previewFen ? null : game?.last_move || null}
            hintMove={previewFen ? null : hintMove}
            disabled={!user || !game || moveBusy || game.status !== 'active' || Boolean(previewFen)}
            zenMode={zenMode}
            onToggleZenMode={() => setZenMode((v) => !v)}
            onAttemptMove={handleAttemptMove}
            onSelectPiece={setSelectedPiece}
            capturedWhite={game?.captured.white || []}
            capturedBlack={game?.captured.black || []}
            status={game?.status || 'active'}
          />

          {bannerNotice && (
            <div
              className={`absolute top-16 left-4 z-20 max-w-md rounded-lg px-3.5 py-2.5 text-xs border shadow-lg ${
                bannerNotice.kind === 'error'
                  ? 'bg-red-950/90 border-red-500/40 text-red-100'
                  : 'bg-[#121722]/95 border-[#D4A359]/40 text-slate-100'
              }`}
            >
              {bannerNotice.text}
            </div>
          )}
        </section>

        {/* Right Minimalist Sidebar */}
        {!zenMode && (
          <aside className="w-full lg:w-[420px] xl:w-[460px] h-[46vh] lg:h-full border-t lg:border-t-0 lg:border-l border-white/[0.08] bg-[#121722] flex flex-col min-h-0 shrink-0">
            <div className="px-4 py-2.5 border-b border-white/[0.07] flex items-center justify-between gap-2 text-[11px] text-slate-400 shrink-0">
              <div className="flex items-center gap-2 min-w-0 truncate">
                {user && (
                  <>
                    <span className="font-medium text-white truncate">{user.username}</span>
                    {user.is_admin && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#D4A359]">Адмін</span>
                      </>
                    )}
                  </>
                )}
                {game?.engine_label && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{game.engine_label}</span>
                  </>
                )}
              </div>

              {user && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-slate-400 hover:text-white flex items-center gap-1 transition-colors shrink-0"
                  title="Вийти"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Вийти</span>
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0">
              {activeTab === 'coach' && (
                <CoachPanel
                  game={game}
                  selectedPiece={selectedPiece}
                  coachResponse={coachResponse}
                  coachError={coachError}
                  coachLoading={coachLoading}
                  autoFallback={autoFallback}
                  onToggleAutoFallback={setAutoFallback}
                  onAskCoach={handleAskCoach}
                  onRequestHint={handleRequestHint}
                  hintActive={Boolean(hintMove)}
                />
              )}

              {activeTab === 'history' && (
                <HistoryPanel
                  history={history}
                  loading={historyLoading}
                  onRefresh={fetchHistory}
                  onPreviewFen={setPreviewFen}
                />
              )}

              {activeTab === 'admin' && user?.is_admin && (
                <AdminPanel
                  logs={logs}
                  usage={usage}
                  sseConnected={sseConnected}
                  filterRequestId={filterRequestId}
                  onChangeFilterRequestId={setFilterRequestId}
                  onClearLogs={handleClearLogs}
                  onUpdateTokenLimit={handleUpdateTokenLimit}
                />
              )}
            </div>
          </aside>
        )}
      </main>

      {/* Step 1: Minimalist Login Modal (Name + optional Gmail) */}
      {authChecked && !user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleLoginSubmit}
            className="w-full max-w-sm bg-[#121722] border border-white/15 rounded-xl p-6 shadow-2xl space-y-4"
          >
            <div>
              <h1 className="text-lg font-semibold text-white">Вхід у ChessMind</h1>
              <p className="text-xs text-slate-400 mt-1">
                Введіть ваше імʼя та за бажанням Gmail для збереження історії партій.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Імʼя гравця
                </label>
                <input
                  type="text"
                  required
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  placeholder="Наприклад, Марина"
                  className="w-full bg-[#0B0E14] border border-white/15 focus:border-[#D4A359] focus:outline-none rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Gmail (необовʼязково)
                </label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="name@gmail.com"
                  className="w-full bg-[#0B0E14] border border-white/15 focus:border-[#D4A359] focus:outline-none rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            {loginError && <p className="text-xs text-red-400">{loginError}</p>}

            <button
              type="submit"
              disabled={loginBusy || loginName.trim().length < 2}
              className="w-full py-2.5 px-4 rounded-lg bg-[#D4A359] hover:bg-[#DFB26B] disabled:opacity-50 text-[#0B0E14] text-sm font-semibold transition-colors"
            >
              {loginBusy ? 'Вхід...' : 'Увійти'}
            </button>
          </form>
        </div>
      )}

      {/* Step 2: Difficulty Setup Modal (Automatic Engine Configuration) */}
      {user && newGameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md bg-[#121722] border border-white/15 rounded-xl p-6 shadow-2xl space-y-5">
            <div>
              <h2 className="text-base font-semibold text-white">
                Нова партія · {user.username}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Оберіть рівень складності — шаховий рушій налаштується автоматично.
              </p>
            </div>

            <div className="space-y-2">
              {LEVEL_CARDS.map((lvl) => (
                <button
                  key={lvl.id}
                  type="button"
                  onClick={() => setSelectedLevel(lvl.id)}
                  className={`w-full px-3.5 py-3 rounded-lg text-left border transition-colors ${
                    selectedLevel === lvl.id
                      ? 'bg-[#D4A359]/15 border-[#D4A359] text-white'
                      : 'bg-[#0B0E14] border-white/10 text-slate-300 hover:text-white'
                  }`}
                >
                  <div className="text-xs font-semibold">{lvl.title}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{lvl.desc}</div>
                </button>
              ))}
            </div>

            <div>
              <div className="text-xs font-medium text-slate-300 mb-1.5">Хто ходить першим</div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'random', label: 'Випадково', icon: true },
                    { id: 'white', label: 'Я (Білі)', icon: false },
                    { id: 'black', label: 'Суперник', icon: false },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setSelectedStarter(st.id)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                      selectedStarter === st.id
                        ? 'bg-[#D4A359]/15 border-[#D4A359] text-white'
                        : 'bg-[#0B0E14] border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    {st.icon && <Shuffle className="w-3.5 h-3.5 text-[#D4A359]" />}
                    <span>{st.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {game && (
                <button
                  type="button"
                  onClick={() => setNewGameOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-white/5 transition-colors"
                >
                  Скасувати
                </button>
              )}
              <button
                type="button"
                disabled={creatingGame}
                onClick={async () => {
                  await createNewGame(selectedLevel, selectedStarter);
                  setNewGameOpen(false);
                }}
                className="px-5 py-2.5 rounded-lg bg-[#D4A359] hover:bg-[#DFB26B] disabled:opacity-50 text-[#0B0E14] text-xs font-semibold transition-colors"
              >
                {creatingGame ? 'Запуск...' : 'Почати партію'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* End-of-Game Modal (Victory / Defeat / Draw) */}
      {showGameOverModal && game && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-sm bg-[#121722] border border-white/15 rounded-xl p-6 shadow-2xl space-y-4 text-center">
            <Trophy
              className={`w-9 h-9 mx-auto ${
                game.winner === game.player_color
                  ? 'text-[#D4A359]'
                  : game.winner === 'draw'
                    ? 'text-slate-300'
                    : 'text-red-400'
              }`}
            />
            <div>
              <h2 className="text-lg font-bold text-white">
                {game.winner === 'draw'
                  ? 'Нічия!'
                  : game.winner === game.player_color
                    ? 'Перемога!'
                    : 'Партію завершено'}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {game.status === 'checkmate'
                  ? game.winner === game.player_color
                    ? 'Ви поставили мат супернику.'
                    : 'Суперник поставив мат.'
                  : 'Пат або нічия за правилами шахів.'}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs bg-[#0B0E14] border border-white/[0.08] rounded-lg p-3 tabular-nums">
              <div>
                <div className="text-[11px] text-slate-400">Ходів</div>
                <div className="font-mono font-semibold text-white mt-0.5">{game.moves.length}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Неточності</div>
                <div className="font-mono font-semibold text-amber-300 mt-0.5">{gameMistakes}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Грубі</div>
                <div className="font-mono font-semibold text-red-400 mt-0.5">{gameBlunders}</div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setGameOverDismissedForId(game.game_id);
                  setActiveTab('history');
                  fetchHistory();
                }}
                className="flex-1 py-2.5 px-3 rounded-lg bg-[#1A2130] hover:bg-[#232D42] border border-white/10 text-xs font-medium text-white transition-colors"
              >
                Історія та розбір
              </button>
              <button
                type="button"
                onClick={() => {
                  setGameOverDismissedForId(game.game_id);
                  setNewGameOpen(true);
                }}
                className="flex-1 py-2.5 px-3 rounded-lg bg-[#D4A359] hover:bg-[#DFB26B] text-[#0B0E14] text-xs font-semibold transition-colors"
              >
                Нова партія
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
