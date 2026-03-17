import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}

export function BottomSheet({ open, onClose, children, title }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-obsidian/75 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Sheet */}
      <div className="relative bg-charcoal border-t border-white/[0.07] rounded-t-3xl max-h-[88vh] overflow-y-auto animate-sheet-up"
        style={{ boxShadow: "0 -20px 60px rgba(0,0,0,0.5), 0 -1px 0 rgba(245,158,11,0.12)" }}
      >
        {/* Drag handle */}
        <div className="sticky top-0 pt-4 pb-2 flex flex-col items-center bg-charcoal z-10">
          <div className="h-1 w-10 rounded-full bg-white/15" />
          {title && (
            <h2 className="font-display text-lg font-semibold text-warm-white mt-4 px-6 w-full">{title}</h2>
          )}
        </div>
        <div className="px-5 pb-10 pt-2">
          {children}
        </div>
      </div>
    </div>
  );
}
