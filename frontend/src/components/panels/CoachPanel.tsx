import { useState, type FormEvent } from 'react';
import {
  Send,
  Sparkles,
  Lightbulb,
  Mic,
  PhoneOff,
  Radio,
  AlertTriangle,
  CheckCircle2,
  GraduationCap,
} from 'lucide-react';
import { useLiveVoiceCoach } from '../../hooks/useLiveVoiceCoach';
import { getBeginnerInteractiveHint, type SelectedPieceInfo } from '../../utils/pieceGuides';
import type {
  CoachResponse,
  ErrorResponse,
  GameStateResponse,
} from '../../types/chessmind';

interface CoachPanelProps {
  game: GameStateResponse | null;
  selectedPiece: SelectedPieceInfo | null;
  coachResponse: CoachResponse | null;
  coachError: ErrorResponse | null;
  coachLoading: boolean;
  autoFallback: boolean;
  onToggleAutoFallback: (enabled: boolean) => void;
  onAskCoach: (question: string) => Promise<CoachResponse | null>;
  onRequestHint: () => Promise<void>;
  hintActive: boolean;
}

export function CoachPanel({
  game,
  selectedPiece,
  coachResponse,
  coachError,
  coachLoading,
  autoFallback,
  onToggleAutoFallback,
  onAskCoach,
  onRequestHint,
  hintActive,
}: CoachPanelProps) {
  const [question, setQuestion] = useState('');

  const {
    liveConnected,
    liveConnecting,
    liveModel,
    liveError,
    transcripts,
    startLiveSession,
    stopLiveSession,
  } = useLiveVoiceCoach({
    gameId: game?.game_id,
    fen: game?.fen,
    level: game?.level,
    lastMistake: game?.last_player_feedback?.note ?? null,
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || coachLoading) return;
    setQuestion('');
    await onAskCoach(trimmed);
  };

  const sfEval = game?.engine_eval;
  const evalNum =
    sfEval?.mate !== null && sfEval?.mate !== undefined
      ? sfEval.mate > 0
        ? 10
        : -10
      : (sfEval?.evaluation ?? 0);
  const whiteAdvantagePct = Math.max(5, Math.min(95, 50 + evalNum * 6));

  const beginnerTip = getBeginnerInteractiveHint(game, selectedPiece);
  const feedback = game?.last_player_feedback;
  const isMistakeFeedback =
    feedback &&
    (feedback.quality === 'inaccuracy' ||
      feedback.quality === 'mistake' ||
      feedback.quality === 'blunder');

  const movePairs: Array<{
    num: number;
    white?: GameStateResponse['moves'][number];
    black?: GameStateResponse['moves'][number];
  }> = [];
  if (game?.moves) {
    for (let i = 0; i < game.moves.length; i += 2) {
      movePairs.push({
        num: Math.floor(i / 2) + 1,
        white: game.moves[i],
        black: game.moves[i + 1],
      });
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto chessmind-scroll divide-y divide-white/[0.07]">
      {/* 1. Minimalist Live Stockfish Evaluation Bar */}
      <div className="p-4 space-y-2 bg-[#0E131D]">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-white">Аналіз позиції (Stockfish)</span>
          <span className="font-mono tabular-nums text-slate-200">
            {sfEval?.mate !== null && sfEval?.mate !== undefined
              ? `Мат у ${Math.abs(sfEval.mate)}`
              : sfEval?.evaluation !== null && sfEval?.evaluation !== undefined
                ? `${sfEval.evaluation > 0 ? '+' : ''}${sfEval.evaluation.toFixed(2)}`
                : '0.00'}
          </span>
        </div>

        {/* Visual Evaluation Bar */}
        <div className="h-2 w-full rounded-full bg-[#242B3A] overflow-hidden flex">
          <div
            className="h-full bg-[#E8D3A2] transition-all duration-300"
            style={{ width: `${whiteAdvantagePct}%` }}
          />
        </div>

        {/* Adaptive Elo line for Intermediate */}
        {game?.level === 'intermediate' && (
          <div className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>Середній рівень адаптується під ваш стиль</span>
            <span className="font-mono text-[#D4A359] tabular-nums">
              ~{game.adaptive_elo} Elo
            </span>
          </div>
        )}
      </div>

      {/* 2. Real-Time Mistake Feedback (shown during play after player moves) */}
      {feedback && (
        <div className="px-4 py-3">
          {isMistakeFeedback ? (
            <div
              className={`rounded-lg border p-3 text-xs space-y-1 ${
                feedback.quality === 'blunder'
                  ? 'bg-red-950/35 border-red-500/35 text-red-100'
                  : 'bg-amber-950/30 border-amber-500/30 text-amber-100'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {feedback.quality === 'blunder'
                    ? 'Груба помилка'
                    : feedback.quality === 'mistake'
                      ? 'Помилка'
                      : 'Неточність'}{' '}
                  на ході {feedback.move}
                </span>
              </div>
              <p className="text-[11px] opacity-90 leading-relaxed">{feedback.note}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                Хід <span className="font-mono font-semibold">{feedback.move}</span> —{' '}
                {feedback.quality === 'best' ? 'найкращий за Stockfish' : 'надійний хід'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 3. Level-Specific Interactive Guidance */}
      {beginnerTip && (
        <div className="px-4 py-3 bg-[#141B29]">
          <div className="rounded-lg border border-[#D4A359]/30 bg-[#D4A359]/[0.07] p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#D4A359]">
              <GraduationCap className="w-4 h-4 shrink-0" />
              <span>{beginnerTip.title}</span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">{beginnerTip.body}</p>
          </div>
        </div>
      )}

      {/* 4. Conversational Voice Coach (Gemini Live) + Text Coach */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">AI-тренер</h2>
            <p className="text-[11px] text-slate-400">
              {game?.level === 'advanced'
                ? 'Високий рівень: підказки лише за вашим запитом'
                : 'Голосова розмова або текстове пояснення'}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={!game || game.status !== 'active' || coachLoading}
              onClick={onRequestHint}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
                hintActive
                  ? 'bg-sky-500/20 border-sky-400/50 text-sky-300'
                  : 'bg-[#1A2130] hover:bg-[#232D42] border-white/10 text-slate-200'
              }`}
              title="Попросити підказку ходу"
            >
              <Lightbulb className="w-3.5 h-3.5 text-[#D4A359]" />
              <span>Підказка</span>
            </button>

            <button
              type="button"
              disabled={liveConnecting}
              onClick={liveConnected ? stopLiveSession : startLiveSession}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
                liveConnected
                  ? 'bg-red-500/20 border-red-500/50 text-red-200'
                  : 'bg-[#1A2130] hover:bg-[#232D42] border-white/10 text-slate-200'
              }`}
              title="Розмовна модель у реальному часі"
            >
              {liveConnected ? (
                <>
                  <PhoneOff className="w-3.5 h-3.5" />
                  <span>Завершити</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5 text-[#D4A359]" />
                  <span>{liveConnecting ? 'Зʼєднання...' : 'Розмова'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Conversational Voice Live Transcript */}
        {(liveConnected || liveError || transcripts.length > 0) && (
          <div className="rounded-lg bg-[#0B0E14] border border-white/10 p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <Radio className="w-3 h-3" />
                <span>{liveConnected ? `Голосовий ефір (${liveModel})` : 'Голосовий чат'}</span>
              </span>
            </div>
            {liveError && <p className="text-xs text-red-400">{liveError}</p>}
            <div className="space-y-1.5 max-h-28 overflow-y-auto chessmind-scroll text-xs">
              {transcripts.map((t) => (
                <div
                  key={t.id}
                  className={
                    t.role === 'user'
                      ? 'text-slate-300'
                      : t.role === 'assistant'
                        ? 'text-[#E8D3A2]'
                        : 'text-slate-500 italic'
                  }
                >
                  {t.role === 'user' ? 'Ви: ' : t.role === 'assistant' ? 'Тренер: ' : ''}
                  {t.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Text question input */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Запитайте про позицію або правило..."
            className="flex-1 min-w-0 bg-[#0B0E14] border border-white/10 focus:border-[#D4A359]/60 focus:outline-none rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={coachLoading || !question.trim()}
            className="px-3 py-2 rounded-lg bg-[#D4A359] hover:bg-[#DFB26B] disabled:opacity-50 text-[#0B0E14] font-semibold text-xs transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{coachLoading ? '...' : 'Запитати'}</span>
          </button>
        </form>

        {/* Auto model fallback preference */}
        <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoFallback}
            onChange={(e) => onToggleAutoFallback(e.target.checked)}
            className="rounded border-white/20 bg-[#0B0E14] accent-[#D4A359]"
          />
          <span>Автоперехід на іншу модель при закінченні токенів</span>
        </label>

        {coachError && (
          <div className="rounded-lg bg-red-950/40 border border-red-500/30 p-3 text-xs text-red-200">
            {coachError.error.message}
          </div>
        )}

        {coachResponse && !coachError && (
          <div className="rounded-lg bg-[#0B0E14]/90 border border-white/10 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1 text-[#D4A359] font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{coachResponse.model}</span>
              </span>
              {coachResponse.fallback_used && (
                <span className="text-amber-300">Резервна модель</span>
              )}
            </div>
            {coachResponse.fallback_reason && (
              <p className="text-[11px] text-amber-300/90">{coachResponse.fallback_reason}</p>
            )}
            <p className="text-xs text-slate-100 leading-relaxed">{coachResponse.answer}</p>
            <div className="pt-2 border-t border-white/[0.06] text-xs text-slate-300 leading-relaxed">
              <span className="text-emerald-400 font-medium">Порада: </span>
              {coachResponse.suggestion}
            </div>
          </div>
        )}
      </div>

      {/* 5. Move History */}
      <div className="p-4 flex-1 flex flex-col min-h-[150px]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-white">
            Ходи партії ({game?.moves.length ?? 0})
          </span>
        </div>

        {movePairs.length === 0 ? (
          <div className="text-xs text-slate-500 py-4 text-center border border-white/[0.06] rounded-lg">
            Зробіть хід на шахівниці.
          </div>
        ) : (
          <div className="border border-white/[0.07] rounded-lg overflow-hidden">
            <div className="grid grid-cols-[36px_1fr_1fr] bg-white/[0.03] border-b border-white/[0.07] text-[11px] font-medium text-slate-400 px-3 py-1.5">
              <span>#</span>
              <span>Білі</span>
              <span>Чорні</span>
            </div>
            <div className="max-h-44 overflow-y-auto chessmind-scroll divide-y divide-white/[0.04]">
              {movePairs.map((pair) => {
                const badge = (m?: GameStateResponse['moves'][number]) => {
                  if (!m?.quality) return '';
                  if (m.quality === 'blunder') return ' ??';
                  if (m.quality === 'mistake') return ' ?';
                  if (m.quality === 'inaccuracy') return ' ?!';
                  return '';
                };
                const colorCls = (m?: GameStateResponse['moves'][number]) => {
                  if (m?.quality === 'blunder') return 'text-red-400';
                  if (m?.quality === 'mistake' || m?.quality === 'inaccuracy') return 'text-amber-300';
                  return 'text-slate-100';
                };
                return (
                  <div
                    key={pair.num}
                    className="grid grid-cols-[36px_1fr_1fr] px-3 py-1.5 text-xs font-mono tabular-nums"
                  >
                    <span className="text-slate-500">{pair.num}.</span>
                    <span className={colorCls(pair.white)} title={pair.white?.mistake_note ?? undefined}>
                      {pair.white ? `${pair.white.san}${badge(pair.white)}` : '—'}
                    </span>
                    <span className={colorCls(pair.black)} title={pair.black?.mistake_note ?? undefined}>
                      {pair.black ? `${pair.black.san}${badge(pair.black)}` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
