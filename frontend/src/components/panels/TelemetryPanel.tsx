import { useMemo, useState } from 'react';
import { Trash2, Activity, Code2, X } from 'lucide-react';
import type { AiUsageMetrics, TelemetryLevel, TelemetryLogEntry } from '../../types/chessmind';

interface TelemetryPanelProps {
  logs: TelemetryLogEntry[];
  usage: AiUsageMetrics;
  sseConnected: boolean;
  filterRequestId: string;
  onChangeFilterRequestId: (id: string) => void;
  onClearLogs: () => Promise<void>;
  onPingHealth: () => Promise<void>;
}

const TELEMETRY_PY_REFERENCE = `class RequestIdFilter(logging.Filter):
    def filter(self, record):
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        return True

formatter = logging.Formatter(
    "%(asctime)s | %(levelname)s | "
    "request_id=%(request_id)s | %(message)s"
)`;

export function TelemetryPanel({
  logs,
  usage,
  sseConnected,
  filterRequestId,
  onChangeFilterRequestId,
  onClearLogs,
  onPingHealth,
}: TelemetryPanelProps) {
  const [levelFilter, setLevelFilter] = useState<'ALL' | TelemetryLevel>('ALL');
  const [showPythonRef, setShowPythonRef] = useState(false);

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

  const budgetPct = Math.min(
    100,
    usage.daily_ai_budget > 0 ? (usage.total_cost / usage.daily_ai_budget) * 100 : 0,
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Telemetry Metrics Header (mirrors storage.py ai_usage + HTTP telemetry) */}
      <div className="p-4 border-b border-white/[0.07] space-y-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Жива телеметрія (telemetry.py)</h2>
            <p className="text-xs text-slate-400">
              Потік подій:{' '}
              <span className={sseConnected ? 'text-emerald-400' : 'text-amber-400'}>
                {sseConnected ? 'SSE підключено' : 'Перепідключення'}
              </span>
              <span className="mx-1.5 text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="font-mono tabular-nums">{logs.length} записів</span>
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onPingHealth}
              className="px-2.5 py-1.5 rounded-lg bg-[#1A2130] hover:bg-[#232D42] border border-white/10 text-[11px] font-medium text-slate-200 transition-colors flex items-center gap-1 whitespace-nowrap"
              title="Викликати GET /health"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>GET /health</span>
            </button>
            <button
              type="button"
              onClick={() => setShowPythonRef((v) => !v)}
              className={`p-1.5 rounded-lg border transition-colors ${
                showPythonRef
                  ? 'bg-[#D4A359]/20 border-[#D4A359]/50 text-[#D4A359]'
                  : 'bg-[#1A2130] border-white/10 text-slate-300 hover:text-white'
              }`}
              title="Показати формат app/telemetry.py"
              aria-label="Показати формат app/telemetry.py"
            >
              <Code2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClearLogs}
              className="p-1.5 rounded-lg bg-[#1A2130] hover:bg-red-950/60 border border-white/10 text-slate-400 hover:text-red-300 transition-colors"
              title="Очистити буфер логів"
              aria-label="Очистити буфер логів"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 4-column unboxed tabular metrics */}
        <div className="grid grid-cols-4 gap-2 pt-1">
          <div className="bg-[#0B0E14] border border-white/[0.07] rounded-lg px-2.5 py-2">
            <div className="text-[11px] text-slate-400">HTTP запити</div>
            <div className="text-sm font-mono font-semibold text-white tabular-nums mt-0.5">
              {usage.total_http_requests}
            </div>
          </div>
          <div className="bg-[#0B0E14] border border-white/[0.07] rounded-lg px-2.5 py-2">
            <div className="text-[11px] text-slate-400">AI запити</div>
            <div className="text-sm font-mono font-semibold text-[#D4A359] tabular-nums mt-0.5">
              {usage.request_count}/{usage.daily_ai_request_limit}
            </div>
          </div>
          <div className="bg-[#0B0E14] border border-white/[0.07] rounded-lg px-2.5 py-2">
            <div className="text-[11px] text-slate-400">Токени</div>
            <div className="text-sm font-mono font-semibold text-slate-200 tabular-nums mt-0.5">
              {usage.input_tokens + usage.output_tokens}
            </div>
          </div>
          <div className="bg-[#0B0E14] border border-white/[0.07] rounded-lg px-2.5 py-2">
            <div className="text-[11px] text-slate-400">Латентність</div>
            <div className="text-sm font-mono font-semibold text-emerald-400 tabular-nums mt-0.5">
              {usage.avg_latency_ms}ms
            </div>
          </div>
        </div>

        {/* Daily AI Budget Progress */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
            <span>Денний AI-бюджет ({usage.usage_date})</span>
            <span>
              ${usage.total_cost.toFixed(5)} / ${usage.daily_ai_budget.toFixed(2)}
            </span>
          </div>
          <div className="h-1.5 w-full bg-[#0B0E14] rounded-full overflow-hidden border border-white/[0.06]">
            <div
              className="h-full bg-[#D4A359] transition-all duration-300"
              style={{ width: `${Math.max(budgetPct, usage.request_count > 0 ? 2 : 0)}%` }}
            />
          </div>
        </div>

        {showPythonRef && (
          <pre className="bg-[#0B0E14] border border-white/10 rounded-lg p-2.5 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
            {TELEMETRY_PY_REFERENCE}
          </pre>
        )}

        {/* Log Level & request_id Filter Controls */}
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
              placeholder="Фільтр request_id..."
              className="w-full bg-[#0B0E14] border border-white/10 focus:border-[#D4A359]/60 focus:outline-none rounded-lg pl-2.5 pr-7 py-1 text-[11px] font-mono text-slate-200 placeholder:text-slate-500"
            />
            {filterRequestId && (
              <button
                type="button"
                onClick={() => onChangeFilterRequestId('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                aria-label="Скинути фільтр"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Streaming Formatted Log Lines */}
      <div className="flex-1 overflow-y-auto chessmind-scroll p-3 space-y-1.5 bg-[#090C11]">
        {filteredLogs.length === 0 ? (
          <div className="text-xs text-slate-500 text-center py-8">
            Немає логів за обраним фільтром.
          </div>
        ) : (
          filteredLogs.map((log) => {
            const levelColor =
              log.level === 'ERROR'
                ? 'text-red-400'
                : log.level === 'WARNING'
                  ? 'text-amber-400'
                  : 'text-emerald-400';

            return (
              <div
                key={log.id}
                className="rounded-md bg-[#111622]/70 hover:bg-[#161D2D] border border-white/[0.05] px-2.5 py-2 font-mono text-[11px] leading-relaxed transition-colors"
              >
                <div className="flex flex-wrap items-center gap-x-1.5 text-slate-400 tabular-nums">
                  <span className="text-slate-500">{log.timestamp}</span>
                  <span className="text-slate-600">|</span>
                  <span className={`font-semibold ${levelColor}`}>{log.level}</span>
                  <span className="text-slate-600">|</span>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeFilterRequestId(
                        filterRequestId === log.request_id ? '' : log.request_id,
                      )
                    }
                    className="text-sky-400 hover:text-sky-300 hover:underline truncate max-w-[160px]"
                    title={`Фільтрувати за request_id=${log.request_id}`}
                  >
                    request_id={log.request_id === '-' ? '-' : log.request_id.slice(0, 8)}
                  </button>
                  <span className="text-slate-600">|</span>
                  <span className="text-slate-300 break-all">{log.message}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
