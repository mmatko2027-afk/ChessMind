import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Trophy } from 'lucide-react';
import type { GameHistoryItem } from '../../types/chessmind';

interface HistoryPanelProps {
  history: GameHistoryItem[];
  loading: boolean;
  onRefresh: () => void;
  onPreviewFen: (fen: string | null) => void;
}

const LEVEL_LABELS: Record<GameHistoryItem['level'], string> = {
  beginner: 'Початківець',
  intermediate: 'Середній',
  advanced: 'Високий',
};

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function HistoryPanel({
  history,
  loading,
  onRefresh,
  onPreviewFen,
}: HistoryPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plyIndex, setPlyIndex] = useState<number>(0);

  const selectedGame = useMemo(
    () => history.find((g) => g.game_id === selectedId) ?? null,
    [history, selectedId],
  );

  const openGameReview = (item: GameHistoryItem) => {
    setSelectedId(item.game_id);
    const lastIdx = item.moves.length;
    setPlyIndex(lastIdx);
    onPreviewFen(lastIdx > 0 ? item.moves[lastIdx - 1].fen : START_FEN);
  };

  const closeReview = () => {
    setSelectedId(null);
    onPreviewFen(null);
  };

  const stepTo = (nextIdx: number) => {
    if (!selectedGame) return;
    const clamped = Math.max(0, Math.min(selectedGame.moves.length, nextIdx));
    setPlyIndex(clamped);
    onPreviewFen(clamped === 0 ? START_FEN : selectedGame.moves[clamped - 1].fen);
  };

  const getResultLabel = (item: GameHistoryItem) => {
    if (item.status === 'active') return 'Триває';
    if (item.winner === 'draw') return 'Нічия';
    return item.winner === item.player_color ? 'Перемога' : 'Поразка';
  };

  const getResultColor = (item: GameHistoryItem) => {
    if (item.status === 'active') return 'text-slate-300';
    if (item.winner === 'draw') return 'text-amber-300';
    return item.winner === item.player_color ? 'text-emerald-400' : 'text-red-400';
  };

  if (selectedGame) {
    const activeMove = plyIndex > 0 ? selectedGame.moves[plyIndex - 1] : null;
    return (
      <div className="flex flex-col h-full overflow-y-auto chessmind-scroll p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/[0.07]">
          <button
            type="button"
            onClick={closeReview}
            className="text-xs text-slate-300 hover:text-white flex items-center gap-1 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>До списку партій</span>
          </button>
          <span className={`text-xs font-semibold ${getResultColor(selectedGame)}`}>
            {getResultLabel(selectedGame)}
          </span>
        </div>

        <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-white font-medium">{LEVEL_LABELS[selectedGame.level]}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{selectedGame.moves_count} півходів</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">Помилок: {selectedGame.mistakes_count + selectedGame.blunders_count}</span>
        </div>

        {/* Replay controls */}
        <div className="flex items-center justify-between gap-2 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-3 py-2">
          <button
            type="button"
            disabled={plyIndex === 0}
            onClick={() => stepTo(0)}
            className="px-2 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-40"
            title="Початок партії"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={plyIndex === 0}
              onClick={() => stepTo(plyIndex - 1)}
              className="p-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white"
              aria-label="Попередній хід"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono tabular-nums text-slate-200 min-w-[70px] text-center">
              {plyIndex} / {selectedGame.moves.length}
            </span>
            <button
              type="button"
              disabled={plyIndex >= selectedGame.moves.length}
              onClick={() => stepTo(plyIndex + 1)}
              className="p-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white"
              aria-label="Наступний хід"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button
            type="button"
            disabled={plyIndex >= selectedGame.moves.length}
            onClick={() => stepTo(selectedGame.moves.length)}
            className="text-xs text-[#D4A359] hover:underline disabled:opacity-40"
          >
            Кінець
          </button>
        </div>

        {/* Active move Stockfish evaluation */}
        {activeMove && (
          <div className="rounded-lg bg-[#0B0E14] border border-white/[0.08] p-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold text-white">
                #{activeMove.ply} {activeMove.san}
              </span>
              {typeof activeMove.eval_cp === 'number' && (
                <span className="font-mono text-slate-300 tabular-nums">
                  {activeMove.eval_cp > 0 ? '+' : ''}
                  {(activeMove.eval_cp / 100).toFixed(2)}
                </span>
              )}
            </div>
            {activeMove.mistake_note && (
              <p
                className={`leading-relaxed ${
                  activeMove.quality === 'blunder'
                    ? 'text-red-300'
                    : activeMove.quality === 'mistake' || activeMove.quality === 'inaccuracy'
                      ? 'text-amber-300'
                      : 'text-slate-300'
                }`}
              >
                {activeMove.mistake_note}
              </p>
            )}
          </div>
        )}

        {/* Clickable move list */}
        <div className="border border-white/[0.07] rounded-lg divide-y divide-white/[0.04] max-h-64 overflow-y-auto chessmind-scroll">
          {selectedGame.moves.map((m, idx) => (
            <button
              key={`${m.ply}-${m.uci}`}
              type="button"
              onClick={() => stepTo(idx + 1)}
              className={`w-full text-left px-3 py-1.5 text-xs font-mono flex items-center justify-between transition-colors ${
                plyIndex === idx + 1 ? 'bg-[#D4A359]/15 text-white' : 'hover:bg-white/[0.03] text-slate-300'
              }`}
            >
              <span>
                {m.ply}. {m.san}
                {m.quality === 'blunder' ? ' ??' : m.quality === 'mistake' ? ' ?' : m.quality === 'inaccuracy' ? ' ?!' : ''}
              </span>
              <span className="text-[11px] text-slate-500">
                {m.color === 'white' ? 'Білі' : 'Чорні'}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto chessmind-scroll p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.07]">
        <div>
          <h2 className="text-sm font-semibold text-white">Історія партій</h2>
          <p className="text-xs text-slate-400">Усі зіграні матчі та розбір ходів</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="px-2.5 py-1.5 rounded-lg bg-[#1A2130] hover:bg-[#232D42] border border-white/10 text-xs text-slate-200 transition-colors"
        >
          {loading ? 'Оновлення...' : 'Оновити'}
        </button>
      </div>

      {history.length === 0 ? (
        <div className="py-10 text-center space-y-2 text-xs text-slate-400 border border-white/[0.06] rounded-lg">
          <Trophy className="w-5 h-5 text-slate-500 mx-auto" />
          <p>Ви ще не зіграли жодної партії. Зробіть кілька ходів, і вона зʼявиться тут.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {history.map((item) => {
            const dateText = new Date(item.created_at).toLocaleString('uk-UA', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <button
                key={item.game_id}
                type="button"
                onClick={() => openGameReview(item)}
                className="w-full text-left rounded-lg bg-[#0B0E14] hover:bg-[#161D2D] border border-white/[0.08] p-3 transition-colors space-y-1"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className={`font-semibold ${getResultColor(item)}`}>
                    {getResultLabel(item)}
                  </span>
                  <span className="text-slate-500 font-mono tabular-nums">{dateText}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-200">{LEVEL_LABELS[item.level]}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{item.moves_count} ходів</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    Помилок: {item.mistakes_count + item.blunders_count}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
