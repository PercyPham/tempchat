import type { RefObject } from "react";
import type { PlainMessage } from "../../pages/ChatPage";

interface Props {
  message: PlainMessage;
  senderName: string;
  unreadRef?: RefObject<HTMLDivElement | null>;
}

function label(message: PlainMessage, senderName: string): string {
  switch (message.systemType) {
    case "joined":       return `${senderName} joined`;
    case "left":         return `${senderName} left`;
    case "boosted":      return `${senderName} boosted the room ⚡`;
    case "history_gap":  return `${message.gapCount ?? "Some"} messages are no longer available`;
    default:             return "System event";
  }
}

export function SystemMessage({ message, senderName, unreadRef }: Props) {
  if (message.systemType === "unread_divider") {
    return (
      <div ref={unreadRef} className="flex items-center gap-3 py-1 animate-fade-in">
        <div className="flex-1 h-px" style={{ background: "var(--tc-divider-line)" }} />
        <span className="text-[11px] tracking-wide" style={{ color: "var(--tc-divider-text)" }}>
          New Messages
        </span>
        <div className="flex-1 h-px" style={{ background: "var(--tc-divider-line)" }} />
      </div>
    );
  }

  const isBoosted = message.systemType === "boosted";
  const isGap = message.systemType === "history_gap";
  return (
    <div className="flex justify-center py-1 animate-fade-in">
      <span
        className="text-[11px] rounded-full px-3.5 py-1 tracking-wide"
        style={
          isBoosted
            ? { background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", color: "rgba(245,158,11,0.7)" }
            : isGap
            ? { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "rgba(239,68,68,0.6)" }
            : { background: "var(--tc-sys-default-bg)", color: "var(--tc-sys-default-color)" }
        }
      >
        {label(message, senderName)}
      </span>
    </div>
  );
}
