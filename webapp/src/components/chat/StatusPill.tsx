import type { CountdownState, Urgency } from "../../hooks/useCountdown";

interface Props {
  countdown: CountdownState;
  onBoost: () => void;
}

const pillStyle: Record<Urgency, React.CSSProperties> = {
  healthy: {
    background: "rgba(17,24,39,0.9)",
    border: "1px solid rgba(245,158,11,0.2)",
    color: "rgba(245,158,11,0.8)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    backdropFilter: "blur(12px)",
  },
  warning: {
    background: "rgba(17,24,39,0.9)",
    border: "1px solid rgba(251,146,60,0.35)",
    color: "#FB923C",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4), 0 0 12px rgba(251,146,60,0.1)",
    backdropFilter: "blur(12px)",
  },
  urgent: {
    background: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.4)",
    color: "#EF4444",
    boxShadow: "0 4px 16px rgba(239,68,68,0.15), 0 0 20px rgba(239,68,68,0.1)",
    backdropFilter: "blur(12px)",
  },
};

export function StatusPill({ countdown, onBoost }: Props) {
  const isUrgent = countdown.urgency === "urgent";

  return (
    <button
      onClick={onBoost}
      title="Tap to boost room"
      className={`fixed bottom-20 right-4 z-30 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-transform active:scale-95 ${isUrgent ? "animate-ember-pulse" : ""}`}
      style={pillStyle[countdown.urgency]}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13 2L4.5 13.5H11L10 22L19.5 10.5H13L13 2Z" />
      </svg>
      <span className="tabular-nums tracking-wide">{countdown.label}</span>
    </button>
  );
}
