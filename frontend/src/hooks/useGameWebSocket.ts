
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ErrorResponse,
  GameStateResponse,
  MoveResponse,
  WsClientMessage,
  WsServerMessage,
} from '../types/chessmind';

interface UseGameWebSocketOptions {
  gameId: string | null;
  onGameState: (state: GameStateResponse | MoveResponse) => void;
  onError: (err: ErrorResponse['error']) => void;
}

export function useGameWebSocket({
  gameId,
  onGameState,
  onError,
}: UseGameWebSocketOptions) {
  const [wsConnected, setWsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);

  const onGameStateRef = useRef(onGameState);
  const onErrorRef = useRef(onError);

  onGameStateRef.current = onGameState;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!gameId) {
      setWsConnected(false);
      return;
    }

    let disposed = false;

    const connect = () => {
      if (disposed) return;

      const proto =
        window.location.protocol === 'https:' ? 'wss:' : 'ws:';

      const wsUrl =
        `${proto}//${window.location.host}/ws/games/${encodeURIComponent(gameId)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }

        retryAttemptRef.current = 0;
        setWsConnected(true);

        const syncMsg: WsClientMessage = { type: 'sync' };
        ws.send(JSON.stringify(syncMsg));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsServerMessage;

          if (
            msg.type === 'game_state' ||
            msg.type === 'move_applied'
          ) {
            onGameStateRef.current(msg.payload);
          } else if (msg.type === 'error') {
            onErrorRef.current(msg.payload);
          }
        } catch {
          // Ignore invalid JSON messages.
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          setWsConnected(false);
        }

        if (disposed) return;

        const delayMs = Math.min(
          1000 * 2 ** retryAttemptRef.current,
          8000
        );

        retryAttemptRef.current += 1;

        reconnectTimerRef.current =
          window.setTimeout(connect, delayMs);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      setWsConnected(false);

      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [gameId]);

  const sendMove = useCallback((uciMove: string): boolean => {
    const ws = wsRef.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const msg: WsClientMessage = {
      type: 'make_move',
      move: uciMove,
    };

    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  return { wsConnected, sendMove };
}
