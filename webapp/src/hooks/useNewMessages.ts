import { useState, useEffect, useRef } from "react";
import { hotel } from "../context/HotelContext";
import { getLastSeenEid } from "../lib/lastSeen";
import type { PersistedRoom } from "../services/HotelManager";

export function useNewMessages(rooms: PersistedRoom[]): Set<string> {
  const [hasNew, setHasNew] = useState<Set<string>>(new Set());
  const hasNewRef = useRef(hasNew);
  hasNewRef.current = hasNew;

  useEffect(() => {
    async function check() {
      // Only poll rooms not already marked — no need to re-fetch once flagged
      const unmarked = rooms.filter((r) => !hasNewRef.current.has(r.roomId));
      if (unmarked.length === 0) return;

      const results = await Promise.allSettled(
        unmarked.map(async (room) => {
          const session = hotel.getSession(room.roomId);
          if (!session) return null;
          const afterEid = getLastSeenEid(room.roomId) || room.joinEid;
          const events = await session.getEvents(afterEid);
          return events.some((ev) => ev.msg) ? room.roomId : null;
        })
      );

      const newlyMarked: string[] = [];
      for (const r of results) {
        if (r.status === "fulfilled" && r.value !== null) {
          newlyMarked.push(r.value);
        }
      }
      if (newlyMarked.length > 0) {
        setHasNew((prev) => new Set([...prev, ...newlyMarked]));
      }
    }

    void check();
    const id = setInterval(() => void check(), 30_000);
    return () => clearInterval(id);
  }, [rooms]);

  return hasNew;
}
