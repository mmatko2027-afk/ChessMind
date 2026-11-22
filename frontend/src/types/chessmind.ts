export type GameLevel = 'beginner' | 'intermediate' | 'advanced';
export type GameOpponent = 'stockfish' | 'maia' | 'human';
export type StarterMode = 'random' | 'white' | 'black';
export type TurnColor = 'white' | 'black';

export interface UserSession {
  user_id: string;
  username: string;
  email?: string;
  created_at: string;
  games_played: number;
}

export interface GameCreateRequest {
  level: GameLevel;
  opponent: GameOpponent;
  starter_mode: StarterMode;
  assistant_position: 'right' | 'left' | 'bottom';
  assistant_appearance: string;
  voice_enabled: boolean;
}

export interface MoveRecord {
  ply: number;
  san: string;
  uci: string;
  from: string;
  to: string;
  color: TurnColor;
  piece: string;
  captured?: string;
  fen: string;
  timestamp: string;
  engine?: string;
}

export interface EngineEvalSnapshot {
  evaluation: number | null;
  mate: number | null;
  bestmove: string | null;
  depth: number | null;
  source: string;
}

export interface GameStateResponse {
  game_id: string;
  status: 'active' | 'checkmate' | 'stalemate' | 'draw';
  level: GameLevel;
  opponent: GameOpponent;
  player_color: TurnColor;
  starter_mode: StarterMode;
  starter_note: string;
  current_turn: TurnColor;
  fen: string;
  is_check: boolean;
  is_checkmate: boolean;
  is_draw: boolean;
  winner: TurnColor | 'draw' | null;
  moves: MoveRecord[];
  captured: {
    white: string[];
    black: string[];
  };
  last_move: { from: string; to: string } | null;
  engine_eval?: EngineEvalSnapshot | null;
}

export interface MoveResponse extends GameStateResponse {
  move: string;
  computer_move: string | null;
  computer_engine?: string | null;
}

export interface CoachRequest {
  game_id?: string | null;
  question: string;
  position: string;
  simulate_error?: 'none' | 'timeout' | 'rate_limit' | 'unavailable';
}

export interface CoachResponse {
  answer: string;
  suggestion: string;
  request_id: string;
  has_enough_data: boolean;
  missing_information: string[];
  provider?: string;
  model?: string;
  latency_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
  stockfish_hint?: string | null;
}

export interface TranscribeResponse {
  text: string;
  request_id: string;
  provider: string;
  model: string;
  latency_ms: number;
}

export interface SpeakResponse {
  audio_base64: string | null;
  mime_type: string;
  fallback_tts: boolean;
  text: string;
  request_id: string;
  provider: string;
  model: string;
  latency_ms: number;
}

export interface AnalysisMistake {
  ply: number;
  move: string;
  severity: 'inaccuracy' | 'mistake' | 'blunder';
  note: string;
}

export interface AnalysisJobResponse {
  job_id: string;
  game_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: {
    summary: string;
    mistakes: AnalysisMistake[];
    recommendations: string[];
  };
}

export interface HealthResponse {
  status: string;
  version: string;
  provider: string;
  model: string;
  mode: string;
  storage: string;
  extra: {
    chess_engine: string;
    stockfish_api: string;
    maia_engine: string;
    voice_models: string;
  };
  uptime_s: number;
}

export interface ErrorDetail {
  kind: string;
  message: string;
  retryable: boolean;
  request_id: string;
}

export interface ErrorResponse {
  error: ErrorDetail;
}

export type TelemetryLevel = 'INFO' | 'WARNING' | 'ERROR';

export interface TelemetryLogEntry {
  id: string;
  timestamp: string;
  level: TelemetryLevel;
  request_id: string;
  message: string;
  formatted: string;
  component:
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
  method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number;
}

export interface AiUsageMetrics {
  usage_date: string;
  request_count: number;
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
  daily_ai_request_limit: number;
  daily_ai_budget: number;
  avg_latency_ms: number;
  total_http_requests: number;
  error_count: number;
}

export interface ApiExchangeLog {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  request_id: string;
  duration_ms: number;
  request_body: unknown;
  response_body: unknown;
}
