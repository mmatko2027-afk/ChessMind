import { useState } from 'react';
import { AlertTriangle, Terminal, Play } from 'lucide-react';
import type { ApiExchangeLog } from '../../types/chessmind';

interface ApiExplorerPanelProps {
  exchanges: ApiExchangeLog[];
  onTestIllegalMove: () => Promise<void>;
  onTestCoachError: (kind: 'timeout' | 'rate_limit' | 'unavailable') => Promise<void>;
  onTestHealth: () => Promise<void>;
}

export function ApiExplorerPanel({
  exchanges,
  onTestIllegalMove,
  onTestCoachError,
  onTestHealth,
}: ApiExplorerPanelProps) {
  const [selectedExchangeId, setSelectedExchangeId] = useState<string | null>(null);
  const [busyTest, setBusyTest] = useState(false);

  const activeExchange =
    exchanges.find((e) => e.id === selectedExchangeId) ?? exchanges[0] ?? null;

  const runTest = async (fn: () => Promise<void>) => {
    setBusyTest(true);
    try {
      await fn();
    } finally {
      setBusyTest(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto chessmind-scroll divide-y divide-white/[0.07]">
      {/* Error & Contract Verification Triggers */}
      <div className="p-4 space-y-2.5">
        <div>
          <h2 className="text-sm font-semibold text-white">Перевірка API-контракту</h2>
          <p className="text-xs text-slate-400">
            Протестуйте реальні HTTP-відповіді та єдиний формат помилок{' '}
            <span className="font-mono text-slate-300">ErrorResponse</span>.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busyTest}
            onClick={() => runTest(onTestHealth)}
            className="px-2.5 py-2 rounded-lg bg-[#1A2130] hover:bg-[#232D42] border border-white/10 text-xs text-slate-200 flex items-center gap-1.5 transition-colors"
          >
            <Play className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">GET /health (200)</span>
          </button>

          <button
            type="button"
            disabled={busyTest}
            onClick={() => runTest(onTestIllegalMove)}
            className="px-2.5 py-2 rounded-lg bg-[#1A2130] hover:bg-amber-950/40 border border-white/10 hover:border-amber-500/40 text-xs text-amber-200 flex items-center gap-1.5 transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">Невірний хід (400)</span>
          </button>

          <button
            type="button"
            disabled={busyTest}
            onClick={() => runTest(() => onTestCoachError('timeout'))}
            className="px-2.5 py-2 rounded-lg bg-[#1A2130] hover:bg-red-950/40 border border-white/10 hover:border-red-500/40 text-xs text-red-200 flex items-center gap-1.5 transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="truncate">Таймаут AI (504)</span>
          </button>

          <button
            type="button"
            disabled={busyTest}
            onClick={() => runTest(() => onTestCoachError('rate_limit'))}
            className="px-2.5 py-2 rounded-lg bg-[#1A2130] hover:bg-red-950/40 border border-white/10 hover:border-red-500/40 text-xs text-red-200 flex items-center gap-1.5 transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="truncate">Ліміт запитів (429)</span>
          </button>
        </div>
      </div>

      {/* Recent HTTP Exchanges */}
      <div className="p-4 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-white">Останні HTTP-виклики</span>
          <span className="font-mono text-slate-400 tabular-nums">{exchanges.length}</span>
        </div>

        <div className="space-y-1 max-h-44 overflow-y-auto chessmind-scroll">
          {exchanges.length === 0 ? (
            <div className="text-xs text-slate-500 py-4 text-center border border-white/[0.06] rounded-lg">
              Виконайте хід або запит, щоб побачити HTTP-обмін.
            </div>
          ) : (
            exchanges.map((ex) => {
              const isSelected = activeExchange?.id === ex.id;
              const statusColor =
                ex.status >= 500
                  ? 'text-red-400'
                  : ex.status >= 400
                    ? 'text-amber-400'
                    : 'text-emerald-400';

              return (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => setSelectedExchangeId(ex.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg border text-xs font-mono transition-colors flex items-center justify-between gap-2 ${
                    isSelected
                      ? 'bg-[#1A2130] border-[#D4A359]/50 text-white'
                      : 'bg-[#0B0E14] border-white/[0.06] text-slate-300 hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`font-semibold shrink-0 ${statusColor}`}>{ex.status}</span>
                    <span className="text-slate-400 shrink-0">{ex.method}</span>
                    <span className="truncate">{ex.path}</span>
                  </div>
                  <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                    {ex.duration_ms}ms
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Active JSON Payload Viewer */}
      {activeExchange && (
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-white">
              <Terminal className="w-3.5 h-3.5 text-[#D4A359]" />
              <span>JSON Payload</span>
            </span>
            <span className="font-mono text-[11px] text-sky-400">
              X-Request-ID: {activeExchange.request_id.slice(0, 8)}
            </span>
          </div>

          {activeExchange.request_body !== null && activeExchange.request_body !== undefined && (
            <div className="space-y-1">
              <div className="text-[11px] text-slate-400 font-mono">Request Body</div>
              <pre className="bg-[#0B0E14] border border-white/[0.08] rounded-lg p-2.5 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-36 chessmind-scroll">
                {JSON.stringify(activeExchange.request_body, null, 2)}
              </pre>
            </div>
          )}

          <div className="space-y-1">
            <div className="text-[11px] text-slate-400 font-mono">
              Response ({activeExchange.status})
            </div>
            <pre className="bg-[#0B0E14] border border-white/[0.08] rounded-lg p-2.5 text-[11px] font-mono text-emerald-200/90 overflow-x-auto max-h-56 chessmind-scroll">
              {JSON.stringify(activeExchange.response_body, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
