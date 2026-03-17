import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { SystemMessage } from "./SystemMessage";
import type { PlainMessage } from "../../pages/ChatPage";

interface Props {
  messages: PlainMessage[];
  selfUid: string;
  memberNames: Map<string, string>;
}

export function MessageFeed({ messages, selfUid, memberNames }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function nameFor(uid: string | null): string {
    if (!uid) return "System";
    return memberNames.get(uid) ?? uid.slice(0, 8);
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
      {messages.map((msg) =>
        msg.systemType ? (
          <SystemMessage
            key={msg.eid}
            message={msg}
            senderName={nameFor(msg.uid)}
          />
        ) : (
          <MessageBubble
            key={msg.eid}
            message={msg}
            isSelf={msg.uid === selfUid}
            senderName={nameFor(msg.uid)}
          />
        )
      )}
      <div ref={bottomRef} />
    </div>
  );
}
