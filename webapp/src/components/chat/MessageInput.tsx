import { useState, useRef, type KeyboardEvent } from "react";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, disabled }: Props) {
  const [text, setText] = useState("");
  const textRef = useRef("");
  const sendGateRef = useRef(false);

  function handleChange(value: string) {
    if (sendGateRef.current) return; // IME fires onChange after Enter; ignore it
    textRef.current = value;
    setText(value);
  }

  function submit() {
    if (sendGateRef.current) return;
    const trimmed = textRef.current.trim();
    if (!trimmed || disabled) return;
    sendGateRef.current = true;
    textRef.current = "";
    setText("");
    onSend(trimmed);
    setTimeout(() => { sendGateRef.current = false; }, 100);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const canSend = text.trim().length > 0 && !disabled;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="flex items-end gap-2 px-4 py-3"
      style={{
        background: "rgba(17,24,39,0.85)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderTop: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message…"
        disabled={disabled}
        rows={1}
        autoComplete="shouldnotautocomplete"
        className="flex-1 text-sm text-warm-white placeholder-warm-white/20 resize-none focus:outline-none bg-transparent leading-relaxed disabled:opacity-50 py-1.5 max-h-28 overflow-y-auto"
        style={{ fieldSizing: "content" } as React.CSSProperties}
      />
      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send"
        className="flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-30"
        style={
          canSend
            ? {
                background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                boxShadow: "0 0 12px rgba(245,158,11,0.35)",
              }
            : { background: "rgba(28,35,51,0.6)" }
        }
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
          className={canSend ? "text-obsidian" : "text-warm-white/30"}>
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}
