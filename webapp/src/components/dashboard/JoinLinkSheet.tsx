import { useState } from "react";

interface ParsedLink {
  roomId: string;
  hash: string;
}

function parseInviteLink(raw: string): ParsedLink | null {
  try {
    // Support both full URLs and relative paths like /join/roomId#key=...
    let url: URL;
    if (raw.startsWith("/")) {
      url = new URL(raw, "https://x");
    } else {
      url = new URL(raw);
    }
    const parts = url.pathname.split("/").filter(Boolean);
    // Expect pathname: /join/:roomId
    if (parts.length < 2 || parts[0] !== "join") return null;
    const roomId = parts[1];
    if (!roomId) return null;
    const hash = url.hash;
    if (!hash.startsWith("#key=")) return null;
    return { roomId, hash };
  } catch {
    return null;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  onJoin: (roomId: string, hash: string) => void;
}

export function JoinLinkSheet({ open, onClose, onJoin }: Props) {
  const [value, setValue] = useState("");
  const parsed = value.trim() ? parseInviteLink(value.trim()) : null;
  const hasInput = value.trim().length > 0;
  const isInvalid = hasInput && !parsed;

  const handleJoin = () => {
    if (!parsed) return;
    onJoin(parsed.roomId, parsed.hash);
    setValue("");
  };

  const handleClose = () => {
    setValue("");
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-300"
        style={{
          background: "rgba(0,0,0,0.6)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          backdropFilter: open ? "blur(4px)" : "none",
        }}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Join a room"
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl border-t border-white/10 px-5 pt-5 pb-8"
        style={{
          background: "var(--tc-surface, #141414)",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
          transform: open ? "translateY(0)" : "translateY(100%)",
          transition: "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)",
          maxWidth: "32rem",
          margin: "0 auto",
        }}
      >
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full bg-white/15 mx-auto mb-6" />

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-display font-bold text-warm-white text-xl">Join a Room</h2>
            <p className="text-warm-white/40 text-sm mt-0.5">Paste your invite link below</p>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="text-warm-white/30 hover:text-warm-white/60 transition-colors p-1 -mr-1 -mt-1"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Input */}
        <div className="relative mb-4">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://app.tempchat.io/join/…"
            rows={3}
            autoComplete="shouldnotautocomplete"
            spellCheck={false}
            className="w-full resize-none rounded-xl px-4 py-3 text-sm font-mono text-warm-white placeholder-warm-white/25 outline-none transition-all"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: isInvalid
                ? "1px solid rgba(239,68,68,0.6)"
                : parsed
                ? "1px solid rgba(245,158,11,0.4)"
                : "1px solid rgba(255,255,255,0.08)",
              boxShadow: parsed ? "0 0 0 3px rgba(245,158,11,0.08)" : isInvalid ? "0 0 0 3px rgba(239,68,68,0.08)" : "none",
            }}
          />
          {isInvalid && (
            <p className="text-red-400/80 text-xs mt-1.5 ml-1">
              That doesn't look like a valid TempChat invite link
            </p>
          )}
          {parsed && (
            <p className="text-amber/60 text-xs mt-1.5 ml-1">
              Room ID: {parsed.roomId}
            </p>
          )}
        </div>

        {/* Join button */}
        <button
          onClick={handleJoin}
          disabled={!parsed}
          className="w-full h-12 rounded-xl font-semibold text-sm transition-all active:scale-[0.98]"
          style={{
            background: parsed
              ? "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)"
              : "rgba(255,255,255,0.06)",
            color: parsed ? "#0a0a0a" : "rgba(255,255,255,0.25)",
            cursor: parsed ? "pointer" : "not-allowed",
            boxShadow: parsed ? "0 0 20px rgba(245,158,11,0.25)" : "none",
          }}
        >
          Join Room
        </button>
      </div>
    </>
  );
}
