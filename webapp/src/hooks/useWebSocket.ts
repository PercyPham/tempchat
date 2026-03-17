import { useEffect, useRef, useCallback } from "react";
import { hotel } from "../context/HotelContext";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080";
const WS_BASE = API_URL.replace(/^http/, "ws");

export type WSEventData = Record<string, unknown>;

interface UseWebSocketOptions {
  roomId: string;
  onEvent: (event: WSEventData) => void;
}

export function useWebSocket({ roomId, onEvent }: UseWebSocketOptions): { send: (data: unknown) => void } {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let reconnectId: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      const session = hotel.getSession(roomId);
      if (!session) return;

      const token = await session.makeToken(session.userId);
      if (cancelled) return;

      const ws = new WebSocket(`${WS_BASE}/v1/rooms/${roomId}/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data as string) as WSEventData;
          void onEventRef.current(event);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!cancelled) {
          reconnectId = setTimeout(() => void connect(), 2000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    void connect();

    return () => {
      cancelled = true;
      if (reconnectId !== null) clearTimeout(reconnectId);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId]);

  return { send };
}
