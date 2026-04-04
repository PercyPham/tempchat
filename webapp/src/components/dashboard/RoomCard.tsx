import { useCountdown } from "../../hooks/useCountdown";
import { CountdownBadge } from "../shared/CountdownBadge";
import { hotelActions } from "../../context/HotelContext";
import type { PersistedRoom } from "../../services/HotelManager";

interface Props {
  room: PersistedRoom;
  name: string | null;
  index: number;
  hasNew?: boolean;
  onClick: () => void;
}

export function RoomCard({ room, name, index, hasNew, onClick }: Props) {
  const countdown = useCountdown(room.expiresAt, () => {
    void hotelActions.verifyExpiredRoom(room.roomId);
  });
  const initial = name ? name.charAt(0).toUpperCase() : "·";
  const isExpired = !!room.expiredState || countdown.expired;
  const isChecking = room.expiredState === 'checking';

  return (
    <button
      onClick={isExpired ? undefined : onClick}
      disabled={isExpired}
      className={`group w-full text-left rounded-2xl overflow-hidden transition-all duration-200 ${isExpired ? "opacity-50 cursor-not-allowed" : "hover:scale-[1.015] active:scale-[0.99]"}`}
      style={{
        animationDelay: `${index * 70}ms`,
        background: "linear-gradient(135deg, var(--tc-card-bg-from) 0%, var(--tc-card-bg-to) 100%)",
        boxShadow: "0 1px 0 var(--tc-card-inset-top) inset, 0 -1px 0 var(--tc-card-inset-bot) inset",
      }}
    >
      <div className="flex items-center gap-4 px-4 py-3.5 relative">
        {/* Amber left accent bar */}
        <div
          className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full transition-all duration-300 group-hover:top-0 group-hover:bottom-0 group-hover:opacity-100 opacity-50"
          style={{ background: "linear-gradient(to bottom, rgba(245,158,11,0.8), rgba(217,119,6,0.5))" }}
        />

        {/* Avatar */}
        <div
          className="flex-shrink-0 h-11 w-11 rounded-xl flex items-center justify-center text-lg font-display font-bold text-amber uppercase transition-all duration-300 group-hover:rounded-2xl"
          style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.15)" }}
        >
          {initial}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-warm-white truncate text-[15px] leading-tight mb-0.5">
            {name ?? <span className="text-warm-white/30">Loading…</span>}
          </p>
          {isChecking
            ? <span className="text-xs text-warm-white/40">Checking…</span>
            : <CountdownBadge label={countdown.label} urgency={countdown.urgency} />
          }
        </div>

        {/* New message indicator */}
        {hasNew && (
          <div
            className="flex-shrink-0 h-2.5 w-2.5 rounded-full"
            style={{ background: "#F59E0B", boxShadow: "0 0 6px rgba(245,158,11,0.8)" }}
          />
        )}

        {/* Chevron */}
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          className="text-warm-white/20 flex-shrink-0 transition-all duration-200 group-hover:text-amber/40 group-hover:translate-x-0.5"
        >
          <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Bottom amber shimmer on hover */}
      <div
        className="h-px w-0 group-hover:w-full transition-all duration-500"
        style={{ background: "linear-gradient(to right, transparent, rgba(245,158,11,0.3), transparent)" }}
      />
    </button>
  );
}
