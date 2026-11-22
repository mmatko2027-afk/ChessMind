import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Send,
  Sparkles,
  Copy,
  Check,
  BarChart2,
  ArrowUpRight,
  Mic,
  Square,
  Volume2,
  VolumeX,
  Cpu,
} from 'lucide-react';
import type {
  AnalysisJobResponse,
  CoachResponse,
  ErrorResponse,
  GameStateResponse,
  SpeakResponse,
  TranscribeResponse,
} from '../../types/chessmind';

interface CoachPanelProps {
  game: GameStateResponse | null;
  coachResponse: CoachResponse | null;
  coachError: ErrorResponse | null;
  coachLoading: boolean;
  analysisJob: AnalysisJobResponse | null;
  analysisLoading: boolean;
  onAskCoach: (question: string) => Promise<CoachResponse | null>;
  onRunAnalysis: () => Promise<void>;
  onEvaluateStockfish: () => Promise<void>;
  evalLoading: boolean;
  onInspectRequestId: (requestId: string) => void;
}

const QUICK_QUESTIONS = [
  'Який найкращий хід зараз?',
  'Чому не можна походити фігурою?',
  'Оціни поточну позицію',
];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function CoachPanel({
  game,
  coachResponse,
  coachError,
  coachLoading,
  analysisJob,
  analysisLoading,
  onAskCoach,
  onRunAnalysis,
  onEvaluateStockfish,
  evalLoading,
  onInspectRequestId,
}: CoachPanelProps) {
  const [question, setQuestion] = useState('');
  const [copiedFen, setCopiedFen] = useState(false);

  // Voice assistant state
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  const speakText = async (textToSpeak: string) => {
    if (!textToSpeak.trim()) return;
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    setSpeaking(true);
    setVoiceStatus('Синтез голосу (Gemini TTS)...');

    try {
      const res = await fetch('/api/coach/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToSpeak, voice_name: 'Kore' }),
      });
      const data = (await res.json()) as SpeakResponse;

      if (data.audio_base64 && !data.fallback_tts) {
        const audio = new Audio(`data:${data.mime_type || 'audio/wav'};base64,${data.audio_base64}`);
        activeAudioRef.current = audio;
        audio.onended = () => {
          setSpeaking(false);
          setVoiceStatus(null);
        };
        audio.onerror = () => {
          setSpeaking(false);
          setVoiceStatus(null);
        };
        setVoiceStatus(`Відтворення (${data.model})`);
        await audio.play();
        return;
      }

      // Browser SpeechSynthesis fallback
      if ('speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(textToSpeak);
        utter.lang = 'uk-UA';
        utter.rate = 1.0;
        utter.onend = () => {
          setSpeaking(false);
          setVoiceStatus(null);
        };
        utter.onerror = () => {
          setSpeaking(false);
          setVoiceStatus(null);
        };
        setVoiceStatus('Озвучення (Web Speech)');
        window.speechSynthesis.speak(utter);
        return;
      }
    } catch {
      // Ignore audio playback failure
    }

    setSpeaking(false);
    setVoiceStatus(null);
  };

  useEffect(() => {
    return () => {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const askAndMaybeSpeak = async (q: string) => {
    const res = await onAskCoach(q);
    if (res && autoSpeak) {
      await speakText(`${res.answer} ${res.suggestion}`);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || coachLoading) return;
    setQuestion('');
    await askAndMaybeSpeak(trimmed);
  };

  const toggleVoiceRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }

    setVoiceStatus(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceStatus('Мікрофон недоступний у цьому браузері.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size === 0) return;

        setTranscribing(true);
        setVoiceStatus('Розпізнавання голосу (Gemini STT)...');
        try {
          const base64 = await blobToBase64(blob);
          const res = await fetch('/api/coach/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_base64: base64, mime_type: mimeType }),
          });
          const data = (await res.json()) as TranscribeResponse;
          if (data.text) {
            setQuestion(data.text);
            setVoiceStatus(`Розпізнано (${data.model})`);
            await askAndMaybeSpeak(data.text);
            setQuestion('');
          }
        } catch {
          setVoiceStatus('Не вдалося розпізнати запис.');
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setVoiceStatus('Запис голосу... Натисніть ще раз щоб зупинити');
    } catch {
      setVoiceStatus('Доступ до мікрофона відхилено.');
    }
  };

  const copyFen = () => {
    if (!game?.fen) return;
    navigator.clipboard?.writeText(game.fen);
    setCopiedFen(true);
    setTimeout(() => setCopiedFen(false), 1600);
  };

  const movePairs: Array<{ num: number; white?: string; black?: string }> = [];
  if (game?.moves) {
    for (let i = 0; i < game.moves.length; i += 2) {
      movePairs.push({
        num: Math.floor(i / 2) + 1,
        white: game.moves[i]?.san,
        black: game.moves[i + 1]?.san,
      });
    }
  }

  const sfEval = game?.engine_eval;

  return (
    <div className="flex flex-col h-full overflow-y-auto chessmind-scroll divide-y divide-white/[0.07]">
      {/* Section 1: Stockfish Live Evaluation Strip */}
      <div className="px-4 py-3 bg-[#0E131D] flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-white">
            <Cpu className="w-3.5 h-3.5 text-[#D4A359] shrink-0" />
            <span>Оцінка позиції (Stockfish)</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 tabular-nums truncate mt-0.5">
            {sfEval ? (
              <>
                <span>
                  {sfEval.mate !== null
                    ? `Мат у ${sfEval.mate}`
                    : sfEval.evaluation !== null
                      ? `${sfEval.evaluation > 0 ? '+' : ''}${sfEval.evaluation.toFixed(2)}`
                      : '0.00'}
                </span>
                {sfEval.bestmove && (
                  <>
                    <span className="mx-1.5 text-slate-600">·</span>
                    <span className="text-emerald-400">best: {sfEval.bestmove}</span>
                  </>
                )}
                <span className="mx-1.5 text-slate-600">·</span>
                <span>{sfEval.source}</span>
              </>
            ) : (
              'Натисніть для запиту до Stockfish API'
            )}
          </div>
        </div>

        <button
          type="button"
          disabled={!game || evalLoading}
          onClick={onEvaluateStockfish}
          className="px-2.5 py-1.5 rounded-lg bg-[#1A2130] hover:bg-[#232D42] disabled:opacity-50 border border-white/10 text-[11px] font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
        >
          {evalLoading ? 'Оцінка...' : 'Оцінити'}
        </button>
      </div>

      {/* Section 2: Gemini Text + Voice Coach */}
      <div className="p-4 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">AI-тренер Gemini (Текст + Голос)</h2>
            <p className="text-xs text-slate-400">
              <span className="font-mono text-slate-300">/api/coach/explain</span> · STT/TTS
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setAutoSpeak((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors flex items-center gap-1 whitespace-nowrap ${
                autoSpeak
                  ? 'bg-[#D4A359]/20 border-[#D4A359]/50 text-[#D4A359]'
                  : 'bg-[#1A2130] border-white/10 text-slate-300 hover:text-white'
              }`}
              title="Автоматично озвучувати відповіді тренера"
            >
              {autoSpeak ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span>Голос</span>
            </button>
            <button
              type="button"
              onClick={onRunAnalysis}
              disabled={!game || analysisLoading}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[#1A2130] hover:bg-[#222B3E] disabled:opacity-50 text-slate-200 border border-white/10 transition-colors flex items-center gap-1 whitespace-nowrap"
            >
              <BarChart2 className="w-3.5 h-3.5 text-[#D4A359]" />
              <span>{analysisLoading ? 'Аналіз...' : 'Розбір'}</span>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <button
            type="button"
            disabled={transcribing || coachLoading}
            onClick={toggleVoiceRecording}
            className={`px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1 shrink-0 ${
              recording
                ? 'bg-red-500/20 border-red-500/60 text-red-300'
                : 'bg-[#1A2130] hover:bg-[#232D42] border-white/10 text-slate-200'
            }`}
            title={recording ? 'Зупинити запис' : 'Запитати голосом (Gemini STT)'}
            aria-label={recording ? 'Зупинити запис' : 'Запитати голосом'}
          >
            {recording ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-3.5 h-3.5 text-[#D4A359]" />}
          </button>

          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={transcribing ? 'Розпізнаю голос...' : 'Запитайте текстом або голосом...'}
            className="flex-1 min-w-0 bg-[#0B0E14] border border-white/10 focus:border-[#D4A359]/60 focus:outline-none rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={coachLoading || transcribing || !question.trim()}
            className="px-3 py-2 rounded-lg bg-[#D4A359] hover:bg-[#DFB26B] disabled:opacity-50 text-[#0B0E14] font-semibold text-xs transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{coachLoading ? 'Думаю...' : 'Запитати'}</span>
          </button>
        </form>

        {voiceStatus && (
          <div className="text-[11px] font-mono text-sky-300">{voiceStatus}</div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {QUICK_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={coachLoading}
              onClick={() => askAndMaybeSpeak(q)}
              className="px-2.5 py-1.5 rounded-md bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 text-[11px] text-slate-300 hover:text-white transition-colors text-left"
            >
              {q}
            </button>
          ))}
        </div>

        {coachError && (
          <div className="rounded-lg bg-red-950/40 border border-red-500/30 p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-red-300">Помилка: {coachError.error.kind}</span>
              <button
                type="button"
                onClick={() => onInspectRequestId(coachError.error.request_id)}
                className="font-mono text-[11px] text-red-300 hover:underline flex items-center gap-1"
              >
                <span>{coachError.error.request_id.slice(0, 8)}</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
            <p className="text-xs text-red-200/90 leading-relaxed">{coachError.error.message}</p>
          </div>
        )}

        {coachResponse && !coachError && (
          <div className="rounded-lg bg-[#0B0E14]/80 border border-white/10 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5 text-[#D4A359] font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{coachResponse.model || 'chessmind-coach'}</span>
              </span>
              <div className="flex items-center gap-2 font-mono tabular-nums">
                <button
                  type="button"
                  disabled={speaking}
                  onClick={() => speakText(`${coachResponse.answer} ${coachResponse.suggestion}`)}
                  className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-sans"
                  title="Озвучити відповідь (Gemini TTS)"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>{speaking ? 'Говорить...' : 'Озвучити'}</span>
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => onInspectRequestId(coachResponse.request_id)}
                  className="text-sky-400 hover:text-sky-300 hover:underline flex items-center gap-0.5"
                  title="Відкрити логи цього request_id у Телеметрії"
                >
                  <span>req:{coachResponse.request_id.slice(0, 8)}</span>
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-100 leading-relaxed">{coachResponse.answer}</p>

            <div className="pt-2 border-t border-white/[0.06]">
              <div className="text-[11px] font-medium text-emerald-400 mb-0.5">Рекомендація</div>
              <p className="text-xs text-slate-300 leading-relaxed">{coachResponse.suggestion}</p>
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Analysis Job Result */}
      {analysisJob && (
        <div className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white">
              Аналіз партії ({analysisJob.job_id})
            </span>
            <span className="font-mono text-[11px] text-slate-300">
              status: {analysisJob.status}
            </span>
          </div>

          {analysisJob.result ? (
            <div className="space-y-2 text-xs text-slate-300">
              <p className="text-slate-200 leading-relaxed">{analysisJob.result.summary}</p>
              {analysisJob.result.mistakes.length > 0 && (
                <div className="space-y-1">
                  {analysisJob.result.mistakes.map((m) => (
                    <div
                      key={`${m.ply}-${m.move}`}
                      className="rounded bg-amber-950/30 border border-amber-500/20 px-2.5 py-1.5 text-[11px] text-amber-200"
                    >
                      <span className="font-mono font-semibold">
                        #{m.ply} {m.move}
                      </span>{' '}
                      — {m.note}
                    </div>
                  ))}
                </div>
              )}
              <ul className="space-y-1 text-[11px] text-slate-400 list-disc list-inside">
                {analysisJob.result.recommendations.map((rec, idx) => (
                  <li key={idx}>{rec}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Виконується фоновий розбір партії...</p>
          )}
        </div>
      )}

      {/* Section 4: Move History & FEN */}
      <div className="p-4 flex-1 flex flex-col min-h-[160px]">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-semibold text-white">
            Історія ходів ({game?.moves.length ?? 0} півходів)
          </span>
          <button
            type="button"
            onClick={copyFen}
            disabled={!game?.fen}
            className="text-[11px] font-mono text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
          >
            {copiedFen ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">FEN скопійовано</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Копіювати FEN</span>
              </>
            )}
          </button>
        </div>

        {movePairs.length === 0 ? (
          <div className="text-xs text-slate-500 py-4 text-center border border-white/[0.06] rounded-lg">
            Зробіть перший хід на 3D-шахівниці.
          </div>
        ) : (
          <div className="border border-white/[0.07] rounded-lg overflow-hidden">
            <div className="grid grid-cols-[44px_1fr_1fr] bg-white/[0.03] border-b border-white/[0.07] text-[11px] font-medium text-slate-400 px-3 py-1.5">
              <span>#</span>
              <span>Білі</span>
              <span>Чорні</span>
            </div>
            <div className="max-h-44 overflow-y-auto chessmind-scroll divide-y divide-white/[0.04]">
              {movePairs.map((pair) => (
                <div
                  key={pair.num}
                  className="grid grid-cols-[44px_1fr_1fr] px-3 py-1.5 text-xs font-mono tabular-nums hover:bg-white/[0.02]"
                >
                  <span className="text-slate-500">{pair.num}.</span>
                  <span className="text-slate-100">{pair.white || '—'}</span>
                  <span className="text-slate-300">{pair.black || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
