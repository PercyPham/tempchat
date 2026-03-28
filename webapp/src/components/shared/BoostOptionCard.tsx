import type { BoostOption } from "../../lib/api";

interface Props {
  option: BoostOption;
  onSelect: (option: BoostOption) => void;
  detectedProvider: "sepay" | "polar";
}

function formatTtl(ms: number): string {
  const hours = ms / (1000 * 60 * 60);
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  return `${Math.round(days)}d`;
}

export function BoostOptionCard({ option, onSelect, detectedProvider }: Props) {
  const primaryPrice =
    detectedProvider === "polar"
      ? `$${(option.priceUsdCents / 100).toFixed(2)}`
      : option.priceVnd.toLocaleString("vi-VN") + " ₫";
  const secondaryPrice =
    detectedProvider === "polar"
      ? option.priceVnd.toLocaleString("vi-VN") + " ₫"
      : `$${(option.priceUsdCents / 100).toFixed(2)}`;

  return (
    <button
      onClick={() => onSelect(option)}
      className="group w-full text-left rounded-2xl p-[1px] transition-all hover:scale-[1.01] active:scale-[0.99]"
      style={{
        background: "linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(245,158,11,0.04) 100%)",
      }}
    >
      <div className="bg-surface-2 rounded-2xl p-4 group-hover:bg-surface transition-colors">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: "rgba(245,158,11,0.7)" }} className="shrink-0">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="font-display font-bold text-warm-white text-base">{option.name}</span>
          </div>
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            <span className="font-display font-bold text-amber text-lg leading-none">{primaryPrice}</span>
            <span className="text-warm-white/30 text-xs leading-none">{secondaryPrice}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            `+${formatTtl(option.ttlMs)}`,
            `${option.maxParticipants} members`,
            `${option.maxEvents} events`,
          ].map((tag) => (
            <span key={tag} className="text-xs bg-warm-white/8 text-warm-white/50 rounded-full px-2.5 py-1">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}
