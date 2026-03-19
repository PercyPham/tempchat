import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function RightPanel({ open, onClose, title, children, footer }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-obsidian/75 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className="relative flex flex-col bg-charcoal h-full animate-panel-right"
        style={{
          width: "min(92vw, 400px)",
          borderLeft: "1px solid var(--tc-panel-border)",
          boxShadow: "-20px 0 60px var(--tc-panel-shadow), -1px 0 0 var(--tc-header-shadow)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--tc-panel-border)" }}
        >
          <h2 className="font-display text-lg font-semibold text-warm-white truncate pr-3">{title}</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center h-8 w-8 rounded-xl transition-colors hover:bg-warm-white/8 text-warm-white/40 hover:text-warm-white/70 flex-shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4">
          {children}
        </div>

        {/* Sticky footer */}
        {footer && (
          <div
            className="flex-shrink-0 px-5 pb-6 pt-3"
            style={{ borderTop: "1px solid var(--tc-panel-border)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
