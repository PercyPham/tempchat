import type { PlainMessage } from "../../pages/ChatPage";

interface Props {
  message: PlainMessage;
  senderName: string;
}

function label(message: PlainMessage, senderName: string): string {
  switch (message.systemType) {
    case "joined":  return `${senderName} joined`;
    case "left":    return `${senderName} left`;
    case "boosted": return `${senderName} boosted the room ⚡`;
    default:        return "System event";
  }
}

export function SystemMessage({ message, senderName }: Props) {
  const isBoosted = message.systemType === "boosted";
  return (
    <div className="flex justify-center py-1 animate-fade-in">
      <span
        className="text-[11px] rounded-full px-3.5 py-1 tracking-wide"
        style={
          isBoosted
            ? { background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", color: "rgba(245,158,11,0.7)" }
            : { background: "rgba(255,255,255,0.04)", color: "rgba(249,250,251,0.3)" }
        }
      >
        {label(message, senderName)}
      </span>
    </div>
  );
}
