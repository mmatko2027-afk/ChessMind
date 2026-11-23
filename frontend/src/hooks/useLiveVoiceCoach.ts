import { useCallback, useEffect, useRef, useState } from 'react';

export interface LiveVoiceMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

interface UseLiveVoiceCoachOptions {
  gameId?: string;
  fen?: string;
  level?: string;
  lastMistake?: string | null;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToPcm16Float32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / 0x8000;
  }
  return float32;
}

export function useLiveVoiceCoach({
  gameId,
  fen,
  level,
  lastMistake,
}: UseLiveVoiceCoachOptions) {
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveConnecting, setLiveConnecting] = useState(false);
  const [liveModel, setLiveModel] = useState<string>('gemini-3.8-live');
  const [liveError, setLiveError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<LiveVoiceMessage[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const stopPlaybackQueue = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // Ignore already stopped source
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
  }, []);

  const playPcmChunk = useCallback((base64Audio: string) => {
    const outCtx = outputCtxRef.current;
    if (!outCtx) return;

    const samples = base64ToPcm16Float32(base64Audio);
    if (samples.length === 0) return;

    const buffer = outCtx.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);

    const source = outCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(outCtx.destination);

    const startAt = Math.max(outCtx.currentTime, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.add(source);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
    };
  }, []);

  const stopLiveSession = useCallback(() => {
    stopPlaybackQueue();

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setLiveConnected(false);
    setLiveConnecting(false);
  }, [stopPlaybackQueue]);

  const startLiveSession = useCallback(async () => {
    if (liveConnected || liveConnecting) return;

    setLiveError(null);
    setLiveConnecting(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setLiveError('Мікрофон недоступний у цьому браузері.');
      setLiveConnecting(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/live-coach`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'context',
            game_id: gameId ?? null,
            fen: fen ?? '',
            level: level ?? 'intermediate',
            last_mistake: lastMistake ?? null,
          }),
        );

        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const channel = e.inputBuffer.getChannelData(0);
          const base64 = float32ToPcm16Base64(channel);
          ws.send(JSON.stringify({ type: 'audio', audio: base64 }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type?: string;
            audio?: string;
            interrupted?: boolean;
            inputTranscript?: string;
            outputTranscript?: string;
            model?: string;
            message?: string;
          };

          if (msg.type === 'ready') {
            setLiveConnecting(false);
            setLiveConnected(true);
            if (msg.model) setLiveModel(msg.model);
            setTranscripts((prev) => [
              ...prev.slice(-14),
              {
                id: `${Date.now()}-sys`,
                role: 'system',
                text: 'Голосовий тренер на звʼязку. Говоріть українською — я бачу дошку.',
              },
            ]);
          } else if (msg.audio) {
            playPcmChunk(msg.audio);
          } else if (msg.interrupted) {
            stopPlaybackQueue();
          } else if (msg.inputTranscript) {
            setTranscripts((prev) => [
              ...prev.slice(-14),
              { id: `${Date.now()}-u-${Math.random()}`, role: 'user', text: msg.inputTranscript! },
            ]);
          } else if (msg.outputTranscript) {
            setTranscripts((prev) => [
              ...prev.slice(-14),
              { id: `${Date.now()}-a-${Math.random()}`, role: 'assistant', text: msg.outputTranscript! },
            ]);
          } else if (msg.type === 'error') {
            setLiveError(msg.message || 'Помилка розмовного режиму.');
            stopLiveSession();
          }
        } catch {
          // Ignore malformed message
        }
      };

      ws.onerror = () => {
        setLiveError('Не вдалося підключити розмовну модель.');
        stopLiveSession();
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          stopLiveSession();
        }
      };
    } catch {
      setLiveError('Доступ до мікрофона відхилено.');
      stopLiveSession();
    }
  }, [
    fen,
    gameId,
    lastMistake,
    level,
    liveConnected,
    liveConnecting,
    playPcmChunk,
    stopLiveSession,
    stopPlaybackQueue,
  ]);

  // Keep live voice coach updated whenever the board position changes
  useEffect(() => {
    const ws = wsRef.current;
    if (liveConnected && ws && ws.readyState === WebSocket.OPEN && fen) {
      ws.send(
        JSON.stringify({
          type: 'context',
          game_id: gameId ?? null,
          fen,
          level: level ?? 'intermediate',
          last_mistake: lastMistake ?? null,
        }),
      );
    }
  }, [liveConnected, gameId, fen, level, lastMistake]);

  useEffect(() => {
    return () => {
      stopLiveSession();
    };
  }, [stopLiveSession]);

  return {
    liveConnected,
    liveConnecting,
    liveModel,
    liveError,
    transcripts,
    startLiveSession,
    stopLiveSession,
  };
}
