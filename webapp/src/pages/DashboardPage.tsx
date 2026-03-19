import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRooms } from "../hooks/useRooms";
import { useNewMessages } from "../hooks/useNewMessages";
import { hotel } from "../context/HotelContext";
import { RoomCard } from "../components/dashboard/RoomCard";
import { EmptyState } from "../components/dashboard/EmptyState";
import { FabButton } from "../components/dashboard/FabButton";
import { ThemeToggle } from "../components/shared/ThemeToggle";

export function DashboardPage() {
  const navigate = useNavigate();
  const rooms = useRooms();
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const newMessages = useNewMessages(rooms);

  useEffect(() => {
    for (const room of rooms) {
      if (names.has(room.roomId)) continue;
      const session = hotel.getSession(room.roomId);
      if (!session) continue;
      session.getRoom()
        .then((info) => setNames((prev) => new Map(prev).set(room.roomId, info.name)))
        .catch(() => setNames((prev) => new Map(prev).set(room.roomId, room.roomId.slice(0, 8))));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms]);

  return (
    <div className="max-w-lg mx-auto px-4 pt-12 pb-24">
      {/* Header */}
      <header className="mb-10 animate-slide-up">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            {/* Ember dot */}
            <div
              className="h-2 w-2 rounded-full"
              style={{ background: "#F59E0B", boxShadow: "0 0 8px rgba(245,158,11,0.8)" }}
            />
            <span className="text-xs font-medium text-amber/70 uppercase tracking-[0.15em]">
              TempChat
            </span>
          </div>
          <ThemeToggle />
        </div>
        <h1
          className="font-display text-4xl font-extrabold leading-none"
          style={{
            background: "var(--tc-title-gradient)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Your Rooms
        </h1>
        <p className="text-warm-white/35 text-sm mt-2 font-light">
          End-to-end encrypted · Zero knowledge
        </p>
      </header>

      {rooms.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-2">
          {rooms.map((room, i) => (
            <div key={room.roomId} className="animate-slide-up" style={{ animationDelay: `${i * 60}ms` }}>
              <RoomCard
                room={room}
                name={names.get(room.roomId) ?? null}
                index={i}
                hasNew={newMessages.has(room.roomId)}
                onClick={() => navigate(`/chat/${room.roomId}`)}
              />
            </div>
          ))}
        </div>
      )}

      <FabButton onClick={() => navigate("/create")} />
    </div>
  );
}
