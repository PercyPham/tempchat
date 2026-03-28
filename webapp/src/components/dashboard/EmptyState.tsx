interface Props {
  onJoin: () => void;
}

export function EmptyState({ onJoin }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-20 px-8 text-center animate-fade-in">
      {/* Glowing lock mark */}
      <div className="relative">
        <div
          className="absolute inset-0 rounded-full blur-xl opacity-40"
          style={{ background: "radial-gradient(circle, rgba(245,158,11,0.5) 0%, transparent 70%)" }}
        />
        <div className="relative rounded-2xl bg-surface border border-amber/15 p-5"
          style={{ boxShadow: "0 0 24px rgba(245,158,11,0.08)" }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-amber/70">
            <rect x="3" y="11" width="18" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="12" cy="16" r="1.5" fill="currentColor" opacity="0.6" />
          </svg>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="font-display font-bold text-warm-white text-xl">No rooms yet</p>
        <p className="text-warm-white/40 text-sm leading-relaxed max-w-xs">
          Create an encrypted room or join one via an invite link. Keys never leave your device.
        </p>
      </div>

      <button
        onClick={onJoin}
        className="text-amber/60 hover:text-amber/90 text-sm font-medium transition-colors flex items-center gap-1.5 underline underline-offset-4 decoration-amber/25 hover:decoration-amber/50"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="shrink-0">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Join a room via invite link
      </button>
    </div>
  );
}
