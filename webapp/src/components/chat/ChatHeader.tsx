import { useNavigate } from "react-router-dom";
import type { CountdownState, Urgency } from "../../hooks/useCountdown";

const boostPillStyle: Record<Urgency, React.CSSProperties> = {
  healthy: {
    background: "var(--tc-boost-pill-healthy-bg)",
    border: "1px solid var(--tc-boost-pill-healthy-bd)",
    color: "rgba(245,158,11,0.8)",
  },
  warning: {
    background: "var(--tc-boost-pill-warning-bg)",
    border: "1px solid var(--tc-boost-pill-warning-bd)",
    color: "#FB923C",
  },
  urgent: {
    background: "var(--tc-boost-pill-urgent-bg)",
    border: "1px solid var(--tc-boost-pill-urgent-bd)",
    color: "#EF4444",
  },
};

interface Props {
  roomName: string;
  memberCount: number;
  countdown: CountdownState;
  onMenuOpen: () => void;
  onBoost: () => void;
}

export function ChatHeader({ roomName, memberCount, countdown, onMenuOpen, onBoost }: Props) {
  const navigate = useNavigate();

  return (
    <header
      className="flex items-center gap-3 px-4 py-3 sticky top-0 z-20"
      style={{
        background: "var(--tc-header-bg)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--tc-header-border)",
        boxShadow: "0 1px 0 var(--tc-header-shadow)",
      }}
    >
      <button
        onClick={() => navigate("/")}
        aria-label="Back"
        className="flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-warm-white/40 hover:text-warm-white hover:bg-warm-white/8 transition-all"
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
          <button
            onClick={onBoost}
            title="Tap to boost room"
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition-transform active:scale-95 ${countdown.urgency === "urgent" ? "animate-ember-pulse" : ""}`}
            style={boostPillStyle[countdown.urgency]}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2L4.5 13.5H11L10 22L19.5 10.5H13L13 2Z" />
            </svg>
            <span className="tabular-nums tracking-wide">{countdown.label}</span>
          </button>
        </div>
      </div>

      <button
        onClick={onMenuOpen}
        aria-label="Room details"
        className="flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-warm-white/40 hover:text-warm-white hover:bg-warm-white/8 transition-all"
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
