import { useMemo, useState } from 'react';
import { Trash2, RefreshCw, X } from 'lucide-react';
import type { AiUsageMetrics, TelemetryLevel, TelemetryLogEntry } from '../../types/chessmind';

interface AdminPanelProps {
  logs: TelemetryLogEntry[];
  usage: AiUsageMetrics;
  sseConnected: boolean;
  filterRequestId: string;
  onChangeFilterRequestId: (id: string) => void;
  onClearLogs: () => Promise<void>;
  onUpdateTokenLimit: (limit: number, resetPrimary?: boolean) => Promise<void>;
}

export function AdminPanel({
  logs,
  usage,
  sseConnected,
  filterRequestId,
  onChangeFilterRequestId,
  onClearLogs,
  onUpdateTokenLimit,
}: AdminPanelProps) {
  const [levelFilter, setLevelFilter] = useState<'ALL' | TelemetryLevel>('ALL');
  const [limitInput, setLimitInput] = useState(String(usage.model_token_limit));

  const filteredLogs = useMemo(() => {
    return logs
      .filter((l) => (levelFilter === 'ALL' ? true : l.level === levelFilter))
      .filter((l) =>
        filterRequestId.trim()
          ? l.request_id.toLowerCase().includes(filterRequestId.trim().toLowerCase())
          : true,
      )
      .slice()
      .reverse();
  }, [logs, levelFilter, filterRequestId]);

  const totalTokens = usage.input_tokens + usage.output_tokens;
  const primaryStats = usage.by_model[usage.primary_model];
  const primaryTokens = primaryStats
    ? primaryStats.input_tokens + primaryStats.output_tokens
    : 0;
  const tokenPct = Math.min(
    100,
    usage.model_token_limit > 0 ? (primaryTokens / usage.model_token_limit) * 100 : 0,
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Admin-only Token & Model Fallback Block */}
      <div className="p-4 border-b border-white/[0.07] space-y-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Адмін-панель · Токени та моделі</h2>
            <p className="text-xs text-slate-400">
              Активна модель:{' '}
              <span className="font-mono text-[#D4A359]">{usage.active_model}</span>
              <span className="mx-1.5 text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className={sseConnected ? 'text-emerald-400' : 'text-amber-400'}>
                {sseConnected ? 'Потік активний' : 'Очікування'}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClearLogs}
            className="p-1.5 rounded-lg bg-[#1A2130] hover:bg-red-950/60 border border-white/10 text-slate-400 hover:text-red-300 transition-colors"
            title="Очистити логи"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Token Metrics Grid */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-[#0B0E14] border border-white/[0.07] rounded-lg px-2.5 py-2">
            <div className="text-[11px] text-slate-400">Токени всього</div>
            <div className="text-sm font-mono font-semibold text-white tabular-nums mt-0.5">
              {totalTokens}
            </div>
          </div>
          <div className="bg-[#0B0E14] border border-white/[0.07] rounded-lg px-2.5 py-2">
            <div className="text-[11px] text-slate-400">AI-запити</div>
            <div className="text-sm font-mono font-semibold text-[#D4A359] tabular-nums mt-0.5">
              {usage.request_count}
            </div>
          </div>
          <div className="bg-[#0B0E14] border border-white/[0.07] rounded-lg px-2.5 py-2">
            <div className="text-[11px] text-slate-400">Перемикань</div>
            <div className="text-sm font-mono font-semibold text-sky-400 tabular-nums mt-0.5">
              {usage.fallback_triggered_count}
            </div>
          </div>
          <div className="bg-[#0B0E14] border border-white/[0.07] rounded-lg px-2.5 py-2">
            <div className="text-[11px] text-slate-400">Вартість</div>
            <div className="text-sm font-mono font-semibold text-emerald-400 tabular-nums mt-0.5">
              ${usage.total_cost.toFixed(4)}
            </div>
          </div>
        </div>

        {/* Model Fallback Threshold Progress */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
            <span>
              Ліміт {usage.primary_model} → {usage.fallback_model}
            </span>
            <span>
              {primaryTokens} / {usage.model_token_limit} tok
            </span>
          </div>
          <div className="h-1.5 w-full bg-[#0B0E14] rounded-full overflow-hidden border border-white/[0.06]">
            <div
              className="h-full bg-[#D4A359] transition-all duration-300"
              style={{ width: `${Math.max(tokenPct, primaryTokens > 0 ? 3 : 0)}%` }}
            />
          </div>
        </div>

        {/* Per-model breakdown */}
        {Object.keys(usage.by_model).length > 0 && (
          <div className="space-y-1 text-[11px] font-mono text-slate-300 bg-[#0B0E14] border border-white/[0.07] rounded-lg p-2.5">
            {Object.entries(usage.by_model).map(([modelName, stats]) => (
              <div key={modelName} className="flex items-center justify-between tabular-nums">
                <span className="text-slate-200">{modelName}</span>
                <span className="text-slate-400">
                  {stats.requests} req · {stats.input_tokens + stats.output_tokens} tok
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Configure fallback threshold */}
        <div className="flex items-center gap-2 text-xs">
          <input
            type="number"
            min={100}
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            className="w-28 bg-[#0B0E14] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
            title="Поріг токенів для автопереходу на резервну модель"
          />
          <button
            type="button"
            onClick={() => onUpdateTokenLimit(Number(limitInput) || 25000)}
            className="px-3 py-1.5 rounded-lg bg-[#1A2130] hover:bg-[#232D42] border border-white/10 text-xs text-slate-200"
          >
            Задати ліміт
          </button>
          <button
            type="button"
            onClick={() => onUpdateTokenLimit(Number(limitInput) || 25000, true)}
            className="px-2.5 py-1.5 rounded-lg bg-[#1A2130] hover:bg-[#232D42] border border-white/10 text-xs text-slate-300 flex items-center gap-1"
            title="Повернути основну модель"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Скинути</span>
          </button>
        </div>

        {/* Log Filters */}
        <div className="flex items-center gap-2 pt-1">
          <div className="flex items-center bg-[#0B0E14] border border-white/10 rounded-lg p-0.5 shrink-0">
            {(['ALL', 'INFO', 'WARNING', 'ERROR'] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevelFilter(lvl)}
                className={`px-2 py-1 rounded-md text-[11px] font-mono transition-colors ${
                  levelFilter === lvl
                    ? 'bg-[#1E2638] text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lvl === 'ALL' ? 'Всі' : lvl}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-0">
            <input
              type="text"
              value={filterRequestId}
              onChange={(e) => onChangeFilterRequestId(e.target.value)}
              placeholder="Пошук за request_id..."
              className="w-full bg-[#0B0E14] border border-white/10 rounded-lg pl-2.5 pr-7 py-1 text-[11px] font-mono text-slate-200"
            />
            {filterRequestId && (
              <button
                type="button"
                onClick={() => onChangeFilterRequestId('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Telemetry Log Stream */}
      <div className="flex-1 overflow-y-auto chessmind-scroll p-3 space-y-1.5 bg-[#090C11]">
        {filteredLogs.length === 0 ? (
          <div className="text-xs text-slate-500 text-center py-8">Немає записів.</div>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              className="rounded-md bg-[#111622]/70 border border-white/[0.05] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-slate-300"
            >
              <span className="text-slate-500">{log.timestamp}</span>{' '}
              <span
                className={
                  log.level === 'ERROR'
                    ? 'text-red-400 font-semibold'
                    : log.level === 'WARNING'
                      ? 'text-amber-400 font-semibold'
                      : 'text-emerald-400 font-semibold'
                }
              >
                {log.level}
              </span>{' '}
              <span className="text-slate-200 break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
