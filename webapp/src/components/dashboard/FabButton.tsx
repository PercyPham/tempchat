interface Props {
  onClick: () => void;
}

export function FabButton({ onClick }: Props) {
  return (
    <button
      onClick={onClick}
      aria-label="Create room"
      className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full flex items-center justify-center active:scale-95 transition-transform animate-glow-ring"
      style={{
        background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-obsidian drop-shadow-sm">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
