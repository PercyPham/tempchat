import type { PlainMessage } from "../../pages/ChatPage";
import { splitDisplayName } from "../../lib/names";

interface Props {
  message: PlainMessage;
  isSelf: boolean;
  senderName: string;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({ message, isSelf, senderName }: Props) {
  const { base, suffix } = splitDisplayName(senderName);
  return (
    <div className={`flex flex-col ${isSelf ? "items-end" : "items-start"} gap-1 animate-msg-in`}>
      {!isSelf && (
        <span className="text-[11px] text-warm-white/30 px-3 tracking-wide">
          {base}
          {suffix && <span className="text-warm-white/20 font-mono">{suffix}</span>}
        </span>
      )}
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${isSelf ? "rounded-br-sm" : "rounded-bl-sm"}`}
        style={
          isSelf
            ? {
                background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                boxShadow: "0 2px 12px rgba(245,158,11,0.25)",
                color: "#0D0F14",
              }
            : {
                background: "var(--tc-msg-other-bg)",
                border: "1px solid var(--tc-msg-other-border)",
                boxShadow: "0 1px 0 var(--tc-msg-other-inset) inset",
                color: "var(--tc-msg-other-color)",
              }
        }
      >
        <p className="text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">{message.text}</p>
      </div>
      <span className="text-[10px] text-warm-white/20 px-3">{formatTime(message.ts)}</span>
    </div>
  );
}
