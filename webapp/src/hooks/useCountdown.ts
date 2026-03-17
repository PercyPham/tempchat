import { useState, useEffect, useRef } from "react";

export type Urgency = "healthy" | "warning" | "urgent";

export interface CountdownState {
  label: string;
  urgency: Urgency;
  expired: boolean;
}

function getInterval(ms: number): number {
  if (ms < 15 * 60 * 1000) return 1000; // < 15min: 1s
  if (ms < 60 * 60 * 1000) return 30 * 1000; // < 1h: 30s
  return 60 * 1000; // >= 1h: 60s
}

function formatMs(ms: number): string {
  if (ms <= 0) return "Expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function getUrgency(ms: number): Urgency {
  if (ms < 15 * 60 * 1000) return "urgent";
  if (ms < 60 * 60 * 1000) return "warning";
  return "healthy";
}

export function useCountdown(expiresAt: number, onExpiry?: () => void): CountdownState {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));
  const onExpiryRef = useRef(onExpiry);
  onExpiryRef.current = onExpiry;

  // Immediately sync remaining when expiresAt changes (e.g. roomInfo loads after mount)
  useEffect(() => {
    setRemaining(Math.max(0, expiresAt - Date.now()));
  }, [expiresAt]);

  // Timer tick chain
  useEffect(() => {
    if (remaining <= 0) {
      onExpiryRef.current?.();
      return;
    }
    const id = setTimeout(() => {
      setRemaining(Math.max(0, expiresAt - Date.now()));
    }, getInterval(remaining));
    return () => clearTimeout(id);
  }, [remaining, expiresAt]);

  const expired = remaining <= 0;
  return {
    label: formatMs(remaining),
    urgency: expired ? "urgent" : getUrgency(remaining),
    expired,
  };
}
