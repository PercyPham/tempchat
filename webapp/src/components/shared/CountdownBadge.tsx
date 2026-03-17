import type { Urgency } from "../../hooks/useCountdown";

interface Props {
  label: string;
  urgency: Urgency;
}

const cls: Record<Urgency, string> = {
  healthy: "text-amber/80",
  warning: "text-orange-400",
  urgent:  "text-crimson",
};

export function CountdownBadge({ label, urgency }: Props) {
  return (
    <span className={`text-xs font-medium tabular-nums tracking-wide ${cls[urgency]}`}>
      {label}
    </span>
  );
}
