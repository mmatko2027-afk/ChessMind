import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Shuffle, LogOut } from 'lucide-react';
import { ChessBoard3D } from './components/chess3d/ChessBoard3D';
import { CoachPanel } from './components/panels/CoachPanel';
import { TelemetryPanel } from './components/panels/TelemetryPanel';
import { ApiExplorerPanel } from './components/panels/ApiExplorerPanel';
import type {
  AiUsageMetrics,
  AnalysisJobResponse,
  ApiExchangeLog,
  CoachResponse,
  EngineEvalSnapshot,
  ErrorResponse,
  GameLevel,
  GameOpponent,
  GameStateResponse,
  HealthResponse,
  MoveResponse,
  StarterMode,
  TelemetryLogEntry,
  UserSession,
} from './types/chessmind';

type InspectorTab = 'coach' | 'telemetry' | 'api';

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
};

export default function App() {
  const [activeTab, setActiveTab] = useState<InspectorTab>('coach');
  const [zenMode, setZenMode] = useState(false);

  // Auth state
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<UserSession | null>(null);
  const [loginName, setLoginName] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Match setup & active game state
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [selectedOpponent, setSelectedOpponent] = useState<GameOpponent>('stockfish');
  const [selectedLevel, setSelectedLevel] = useState<GameLevel>('intermediate');
  const [selectedStarter, setSelectedStarter] = useState<StarterMode>('random');
  const [creatingGame, setCreatingGame] = useState(false);

  const [game, setGame] = useState<GameStateResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [evalLoading, setEvalLoading] = useState(false);

  const [coachResponse, setCoachResponse] = useState<CoachResponse | null>(null);
  const [coachError, setCoachError] = useState<ErrorResponse | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);

  const [analysisJob, setAnalysisJob] = useState<AnalysisJobResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const [logs, setLogs] = useState<TelemetryLogEntry[]>([]);
  const [usage, setUsage] = useState<AiUsageMetrics>(DEFAULT_USAGE);
  const [sseConnected, setSseConnected] = useState(false);
  const [filterRequestId, setFilterRequestId] = useState('');

  const [exchanges, setExchanges] = useState<ApiExchangeLog[]>([]);
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
    const t = setTimeout(() => setBannerNotice(null), 4600);
    return () => clearTimeout(t);
  }, [bannerNotice]);

  const refreshTelemetrySnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/telemetry/logs');
      if (!res.ok) return;
      const data = await res.json();
      setLogs(data.logs ?? []);
      if (data.usage) setUsage(data.usage);
    } catch {
      // Ignore transient network hiccup
    }
  }, []);

  const callApi = useCallback(
    async <T,>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ ok: boolean; status: number; data: T; requestId: string }> => {
      const start = performance.now();
      const res = await fetch(path, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const durationMs = Math.round(performance.now() - start);
      const requestId = res.headers.get('X-Request-ID') || '-';
      const data = (await res.json()) as T;

      setExchanges((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: new Date().toLocaleTimeString('uk-UA'),
          method,
          path,
          status: res.status,
          request_id: requestId,
          duration_ms: durationMs,
          request_body: body ?? null,
          response_body: data,
        },
        ...prev.slice(0, 29),
      ]);

      refreshTelemetrySnapshot();
      return { ok: res.ok, status: res.status, data, requestId };
    },
    [refreshTelemetrySnapshot],
  );

  const createNewGame = useCallback(
    async (level: GameLevel, opponent: GameOpponent, starterMode: StarterMode) => {
      setCreatingGame(true);
      try {
        const payload = {
          level,
          opponent,
          starter_mode: starterMode,
          assistant_position: 'right',
          assistant_appearance: 'owl',
          voice_enabled: true,
        };
        const result = await callApi<GameStateResponse>('POST', '/api/games', payload);
        if (result.ok) {
          setGame(result.data);
          setCoachResponse(null);
          setCoachError(null);
          setAnalysisJob(null);
          showNotice('info', result.data.starter_note);
        }
      } finally {
        setCreatingGame(false);
      }
    },
    [callApi, showNotice],
  );

  const pingHealth = useCallback(async () => {
    const result = await callApi<HealthResponse>('GET', '/health');
    if (result.ok) {
      setHealth(result.data);
    }
  }, [callApi]);

  // Initial bootstrap: check session, check health, subscribe to SSE logs
  useEffect(() => {
    if (initDoneRef.current) return;
    initDoneRef.current = true;

    pingHealth();

    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = (await res.json()) as { authenticated: boolean; user: UserSession | null };
        if (data.authenticated && data.user) {
          setUser(data.user);
          setNewGameOpen(true);
        }
      } finally {
        setAuthChecked(true);
      }
    })();

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
      } catch {
        // Ignore malformed event
      }
    };

    return () => {
      eventSource.close();
    };
  }, [pingHealth]);

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
      const res = await callApi<{ authenticated: boolean; user: UserSession } | ErrorResponse>(
        'POST',
        '/api/auth/login',
        { username: trimmed, email: loginEmail.trim() },
      );
      if (res.ok && 'user' in res.data) {
        setUser(res.data.user);
        setNewGameOpen(true);
      } else if ('error' in res.data) {
        setLoginError(res.data.error.message);
      }
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    await callApi('POST', '/api/auth/logout');
    setUser(null);
    setGame(null);
    setNewGameOpen(false);
  };

  const handleAttemptMove = useCallback(
    async (from: string, to: string, promotion?: string) => {
      if (!game || moveBusy) return;
      setMoveBusy(true);
      const uci = `${from}${to}${promotion ?? ''}`;
      try {
        const res = await callApi<MoveResponse | ErrorResponse>(
          'POST',
          `/api/games/${game.game_id}/moves`,
          { move: uci },
        );
        if (res.ok) {
          setGame(res.data as MoveResponse);
        } else {
          const err = res.data as ErrorResponse;
          showNotice('error', `${err.error.message} (request_id=${err.error.request_id.slice(0, 8)})`);
        }
      } finally {
        setMoveBusy(false);
      }
    },
    [game, moveBusy, callApi, showNotice],
  );

  const handleEvaluateStockfish = useCallback(async () => {
    if (!game || evalLoading) return;
    setEvalLoading(true);
    try {
      const res = await callApi<EngineEvalSnapshot & { request_id: string }>(
        'POST',
        '/api/engine/evaluate',
        { game_id: game.game_id, fen: game.fen, depth: 10 },
      );
      if (res.ok) {
        setGame((prev) => (prev ? { ...prev, engine_eval: res.data } : prev));
      }
    } finally {
      setEvalLoading(false);
    }
  }, [game, evalLoading, callApi]);

  const handleAskCoach = useCallback(
    async (question: string): Promise<CoachResponse | null> => {
      setCoachLoading(true);
      setCoachError(null);
      try {
        const res = await callApi<CoachResponse | ErrorResponse>('POST', '/api/coach/explain', {
          game_id: game?.game_id ?? null,
          question,
          position: game?.fen ?? 'current',
        });
        if (res.ok) {
          const data = res.data as CoachResponse;
          setCoachResponse(data);
          return data;
        } else {
          setCoachError(res.data as ErrorResponse);
          return null;
        }
      } finally {
        setCoachLoading(false);
      }
    },
    [game, callApi],
  );

  const handleRunAnalysis = useCallback(async () => {
    if (!game) return;
    setAnalysisLoading(true);
    try {
      const startRes = await callApi<AnalysisJobResponse>('POST', '/api/games/analyze', {
        game_id: game.game_id,
      });
      if (!startRes.ok) {
        setAnalysisLoading(false);
        return;
      }
      setAnalysisJob(startRes.data);

      const jobId = startRes.data.job_id;
      const poll = async (attempt = 0) => {
        if (attempt > 12) {
          setAnalysisLoading(false);
          return;
        }
        const pollRes = await callApi<AnalysisJobResponse>('GET', `/api/games/analyze/${jobId}`);
        if (pollRes.ok) {
          setAnalysisJob(pollRes.data);
          if (pollRes.data.status === 'completed' || pollRes.data.status === 'failed') {
            setAnalysisLoading(false);
            return;
          }
        }
        setTimeout(() => poll(attempt + 1), 280);
      };
      setTimeout(() => poll(0), 280);
    } catch {
      setAnalysisLoading(false);
    }
  }, [game, callApi]);

  const handleClearLogs = useCallback(async () => {
    const res = await fetch('/api/telemetry/logs', { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs ?? []);
      if (data.usage) setUsage(data.usage);
    }
  }, []);

  const handleTestIllegalMove = useCallback(async () => {
    if (!game) return;
    const res = await callApi<ErrorResponse>('POST', `/api/games/${game.game_id}/moves`, {
      move: 'e2e5',
    });
    if (!res.ok) {
      showNotice(
        'error',
        `Тест 400 ${res.data.error.kind}: ${res.data.error.message} (req=${res.data.error.request_id.slice(0, 8)})`,
      );
    }
  }, [game, callApi, showNotice]);

  const handleTestCoachError = useCallback(
    async (kind: 'timeout' | 'rate_limit' | 'unavailable') => {
      const res = await callApi<ErrorResponse>('POST', '/api/coach/explain', {
        game_id: game?.game_id ?? null,
        question: 'Перевірка обробки збою провайдера',
        position: game?.fen ?? 'current',
        simulate_error: kind,
      });
      if (!res.ok) {
        setCoachError(res.data);
        showNotice(
          'error',
          `Тест ${res.status} ${res.data.error.kind}: ${res.data.error.message}`,
        );
      }
    },
    [game, callApi, showNotice],
  );

  const inspectRequestIdInTelemetry = useCallback((reqId: string) => {
    setFilterRequestId(reqId);
    setActiveTab('telemetry');
    setZenMode(false);
  }, []);

  const levelOptions =
    selectedOpponent === 'maia'
      ? ([
          { id: 'beginner', label: 'Maia 1100' },
          { id: 'intermediate', label: 'Maia 1500' },
          { id: 'advanced', label: 'Maia 1900' },
        ] as const)
      : ([
          { id: 'beginner', label: 'Початківець' },
          { id: 'intermediate', label: 'Середній' },
          { id: 'advanced', label: 'Майстер' },
        ] as const);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0B0E14] text-[#E6E9EF] overflow-hidden">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="h-14 px-6 border-b border-white/[0.08] bg-[#0F141E] flex items-center justify-between gap-8 shrink-0">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setZenMode(false);
          }}
          className="text-lg font-bold tracking-tight text-white font-display whitespace-nowrap shrink-0"
        >
          ChessMind
        </a>

        <nav className="flex items-center gap-6 text-sm font-medium">
          {(
            [
              { id: 'coach', label: 'AI-тренер' },
              { id: 'telemetry', label: 'Телеметрія' },
              { id: 'api', label: 'API-контракт' },
            ] as const
          ).map((item) => {
            const isActive = !zenMode && activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setZenMode(false);
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
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row relative">
        {/* Primary 3D Chessboard Stage */}
        <section className="flex-1 min-h-[380px] lg:min-h-0 relative">
          <ChessBoard3D
            gameId={game?.game_id}
            fen={game?.fen || INITIAL_FEN}
            currentTurn={game?.current_turn || 'white'}
            playerColor={game?.player_color || 'white'}
            opponent={game?.opponent || 'stockfish'}
            starterNote={game?.starter_note}
            isCheck={game?.is_check || false}
            lastMove={game?.last_move || null}
            disabled={!user || !game || moveBusy || game.status !== 'active'}
            zenMode={zenMode}
            onToggleZenMode={() => setZenMode((v) => !v)}
            onAttemptMove={handleAttemptMove}
            capturedWhite={game?.captured.white || []}
            capturedBlack={game?.captured.black || []}
            status={game?.status || 'active'}
          />

          {/* Subtle Non-Obtrusive Notice / Error Banner */}
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

        {/* Right Coach / Telemetry / API Sidebar (exact right-side layout) */}
        {!zenMode && (
          <aside className="w-full lg:w-[440px] xl:w-[480px] h-[46vh] lg:h-full border-t lg:border-t-0 lg:border-l border-white/[0.08] bg-[#121722] flex flex-col min-h-0 shrink-0">
            {/* Sub-header metadata line (unboxed, zero pills) */}
            <div className="px-4 py-2.5 border-b border-white/[0.07] flex items-center justify-between gap-2 text-[11px] text-slate-400 shrink-0">
              <div className="flex items-center gap-2 min-w-0 truncate">
                {user && (
                  <>
                    <span className="font-medium text-white truncate">{user.username}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span className="font-mono text-slate-300">{game?.game_id || '—'}</span>
                {game && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {game.opponent === 'stockfish'
                        ? 'Stockfish'
                        : game.opponent === 'maia'
                          ? 'Maia Chess'
                          : '2 гравці'}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-slate-400 hidden sm:inline">
                  {health ? `${health.provider}` : 'chessmind'}
                </span>
                {user && (
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
                    title="Вийти з акаунта"
                  >
                    <LogOut className="w-3 h-3" />
                    <span>Вийти</span>
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0">
              {activeTab === 'coach' && (
                <CoachPanel
                  game={game}
                  coachResponse={coachResponse}
                  coachError={coachError}
                  coachLoading={coachLoading}
                  analysisJob={analysisJob}
                  analysisLoading={analysisLoading}
                  onAskCoach={handleAskCoach}
                  onRunAnalysis={handleRunAnalysis}
                  onEvaluateStockfish={handleEvaluateStockfish}
                  evalLoading={evalLoading}
                  onInspectRequestId={inspectRequestIdInTelemetry}
                />
              )}

              {activeTab === 'telemetry' && (
                <TelemetryPanel
                  logs={logs}
                  usage={usage}
                  sseConnected={sseConnected}
                  filterRequestId={filterRequestId}
                  onChangeFilterRequestId={setFilterRequestId}
                  onClearLogs={handleClearLogs}
                  onPingHealth={pingHealth}
                />
              )}

              {activeTab === 'api' && (
                <ApiExplorerPanel
                  exchanges={exchanges}
                  onTestIllegalMove={handleTestIllegalMove}
                  onTestCoachError={handleTestCoachError}
                  onTestHealth={pingHealth}
                />
              )}
            </div>
          </aside>
        )}
      </main>

      {/* Step 1: Player Login Modal */}
      {authChecked && !user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleLoginSubmit}
            className="w-full max-w-md bg-[#121722] border border-white/15 rounded-xl p-6 shadow-2xl space-y-5"
          >
            <div>
              <h1 className="text-lg font-semibold text-white">Вхід у ChessMind</h1>
              <p className="text-xs text-slate-400 mt-1">
                Увійдіть, щоб обрати шаховий рушій (Stockfish або Maia Chess), рівень та провести
                жеребкування першого ходу.
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
                  Email (необовʼязково)
                </label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="player@example.com"
                  className="w-full bg-[#0B0E14] border border-white/15 focus:border-[#D4A359] focus:outline-none rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            {loginError && (
              <p className="text-xs text-red-400">{loginError}</p>
            )}

            <button
              type="submit"
              disabled={loginBusy || loginName.trim().length < 2}
              className="w-full py-2.5 px-4 rounded-lg bg-[#D4A359] hover:bg-[#DFB26B] disabled:opacity-50 text-[#0B0E14] text-sm font-semibold transition-colors"
            >
              {loginBusy ? 'Вхід...' : 'Увійти до гри'}
            </button>
          </form>
        </div>
      )}

      {/* Step 2: Engine, Level & Random First-Player Draw Modal */}
      {user && newGameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg bg-[#121722] border border-white/15 rounded-xl p-6 shadow-2xl space-y-5">
            <div>
              <h2 className="text-base font-semibold text-white">
                Налаштування партії · {user.username}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Оберіть рушій API, складність та порядок першого ходу.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium text-slate-300 mb-1.5">Рушій / Суперник</div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'stockfish', label: 'Stockfish API', sub: 'Класичний рушій' },
                      { id: 'maia', label: 'Maia Chess', sub: 'Людський стиль Elo' },
                      { id: 'human', label: '2 гравці', sub: 'Локально' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSelectedOpponent(opt.id)}
                      className={`px-3 py-2.5 rounded-lg text-left border transition-colors ${
                        selectedOpponent === opt.id
                          ? 'bg-[#D4A359]/15 border-[#D4A359] text-white'
                          : 'bg-[#0B0E14] border-white/10 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-semibold">{opt.label}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {selectedOpponent !== 'human' && (
                <div>
                  <div className="text-xs font-medium text-slate-300 mb-1.5">Рівень складності</div>
                  <div className="grid grid-cols-3 gap-2">
                    {levelOptions.map((lvl) => (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() => setSelectedLevel(lvl.id)}
                        className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                          selectedLevel === lvl.id
                            ? 'bg-[#D4A359]/15 border-[#D4A359] text-white'
                            : 'bg-[#0B0E14] border-white/10 text-slate-400 hover:text-white'
                        }`}
                      >
                        {lvl.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedOpponent !== 'human' && (
                <div>
                  <div className="text-xs font-medium text-slate-300 mb-1.5">
                    Хто ходить першим (колір фігур)
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'random', label: 'Випадково', icon: true },
                        { id: 'white', label: 'Я (Білі)', icon: false },
                        { id: 'black', label: 'Суперник (Білі)', icon: false },
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
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
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
                  await createNewGame(selectedLevel, selectedOpponent, selectedStarter);
                  setNewGameOpen(false);
                }}
                className="px-5 py-2.5 rounded-lg bg-[#D4A359] hover:bg-[#DFB26B] disabled:opacity-50 text-[#0B0E14] text-xs font-semibold transition-colors"
              >
                {creatingGame ? 'Жеребкування та запуск...' : 'Почати партію'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
