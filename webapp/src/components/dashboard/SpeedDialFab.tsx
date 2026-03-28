import { useState } from "react";

interface Props {
  onCreate: () => void;
  onJoin: () => void;
}

export function SpeedDialFab({ onCreate, onJoin }: Props) {
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <>
      {/* Backdrop — closes dial on tap-away */}
      {open && (
        <div
          className="fixed inset-0 z-30"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Speed dial container */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">

        {/* Mini action: Join */}
        <div
          className="flex items-center gap-2.5"
          style={{
            opacity: open ? 1 : 0,
            transform: open ? "translateY(0) scale(1)" : "translateY(16px) scale(0.85)",
            transition: "opacity 180ms ease, transform 180ms ease",
            transitionDelay: open ? "60ms" : "0ms",
            pointerEvents: open ? "auto" : "none",
          }}
        >
          <span
            className="text-xs font-medium text-warm-white/70 bg-surface border border-white/10 rounded-full px-3 py-1 select-none"
            style={{ backdropFilter: "blur(8px)" }}
          >
            Join room
          </span>
          <button
            onClick={() => { close(); onJoin(); }}
            aria-label="Join a room"
            className="h-11 w-11 rounded-full flex items-center justify-center active:scale-95 transition-transform bg-surface border border-amber/30"
            style={{ boxShadow: "0 0 16px rgba(245,158,11,0.15)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-amber">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Mini action: Create */}
        <div
          className="flex items-center gap-2.5"
          style={{
            opacity: open ? 1 : 0,
            transform: open ? "translateY(0) scale(1)" : "translateY(12px) scale(0.85)",
            transition: "opacity 180ms ease, transform 180ms ease",
            transitionDelay: open ? "30ms" : "0ms",
            pointerEvents: open ? "auto" : "none",
          }}
        >
          <span
            className="text-xs font-medium text-warm-white/70 bg-surface border border-white/10 rounded-full px-3 py-1 select-none"
            style={{ backdropFilter: "blur(8px)" }}
          >
            Create room
          </span>
          <button
            onClick={() => { close(); onCreate(); }}
            aria-label="Create a room"
            className="h-11 w-11 rounded-full flex items-center justify-center active:scale-95 transition-transform bg-surface border border-amber/30"
            style={{ boxShadow: "0 0 16px rgba(245,158,11,0.15)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-amber">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Main FAB — rotates to × when open */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close actions" : "Open actions"}
          aria-expanded={open}
          className="h-14 w-14 rounded-full flex items-center justify-center active:scale-95 animate-glow-ring"
          style={{
            background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
            transition: "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-obsidian drop-shadow-sm">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>

      </div>
    </>
  );
}
