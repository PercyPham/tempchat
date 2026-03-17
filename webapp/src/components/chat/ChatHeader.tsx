import { useNavigate } from "react-router-dom";
import { CountdownBadge } from "../shared/CountdownBadge";
import type { CountdownState } from "../../hooks/useCountdown";

interface Props {
  roomName: string;
  memberCount: number;
  countdown: CountdownState;
  onMenuOpen: () => void;
}

export function ChatHeader({ roomName, memberCount, countdown, onMenuOpen }: Props) {
  const navigate = useNavigate();

  return (
    <header
      className="flex items-center gap-3 px-4 py-3 sticky top-0 z-20"
      style={{
        background: "rgba(17,24,39,0.85)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        boxShadow: "0 1px 0 rgba(245,158,11,0.06)",
      }}
    >
      <button
        onClick={() => navigate("/")}
        aria-label="Back"
        className="flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-warm-white/40 hover:text-warm-white hover:bg-white/6 transition-all"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M19 12H5M5 12l7 7M5 12l7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="flex-1 min-w-0">
        <p className="font-display font-bold text-warm-white truncate text-[15px] leading-tight">{roomName}</p>
        <div className="flex items-center gap-2">
          <span className="text-warm-white/30 text-xs">{memberCount} member{memberCount !== 1 ? "s" : ""}</span>
          <span className="text-warm-white/15 text-xs">·</span>
          <CountdownBadge label={countdown.label} urgency={countdown.urgency} />
        </div>
      </div>

      <button
        onClick={onMenuOpen}
        aria-label="Room details"
        className="flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-warm-white/40 hover:text-warm-white hover:bg-white/6 transition-all"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="5" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="19" r="1.5" fill="currentColor" />
        </svg>
      </button>
    </header>
  );
}
