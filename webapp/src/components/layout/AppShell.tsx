import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-obsidian font-body text-warm-white relative overflow-x-hidden">
      {/* Ambient ember glow — bottom centre */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-56 pointer-events-none"
        style={{ background: "var(--tc-ambient-bottom)" }}
      />
      {/* Secondary glow — top right corner */}
      <div
        className="fixed top-0 right-0 w-72 h-72 pointer-events-none"
        style={{ background: "var(--tc-ambient-top)" }}
      />
      {children}
    </div>
  );
}
