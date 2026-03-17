import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import { SystemMessage } from "./SystemMessage";
import type { PlainMessage } from "../../pages/ChatPage";

interface Props {
  messages: PlainMessage[];
  selfUid: string;
  memberNames: Map<string, string>;
  firstUnreadEid?: number;
}

export function MessageFeed({ messages, selfUid, memberNames, firstUnreadEid }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const unreadRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const prevLengthRef = useRef(messages.length);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  // Track whether the bottom sentinel is visible
  useEffect(() => {
    const sentinel = bottomRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsAtBottom(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (messages.length === 0) return;
    if (!initializedRef.current) {
      // First load: jump to unread divider or bottom instantly
      initializedRef.current = true;
      prevLengthRef.current = messages.length;
      const target = firstUnreadEid != null && unreadRef.current ? unreadRef : bottomRef;
      target.current?.scrollIntoView({ behavior: "instant" });
    } else {
      const newCount = messages.length - prevLengthRef.current;
      prevLengthRef.current = messages.length;
      if (newCount <= 0) return;

      const lastMsg = messages[messages.length - 1];
      const isSelfMessage = lastMsg?.uid === selfUid;
      if (isAtBottom || isSelfMessage) {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        setUnreadCount(0);
      } else {
        setUnreadCount((n) => n + newCount);
      }
    }
  }, [messages, firstUnreadEid, isAtBottom, selfUid]);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUnreadCount(0);
  }

  function nameFor(uid: string | null): string {
    if (!uid) return "System";
    return memberNames.get(uid) ?? uid.slice(0, 8);
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="absolute inset-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.map((msg) =>
          msg.systemType ? (
            <SystemMessage
              key={msg.eid}
              message={msg}
              senderName={nameFor(msg.uid)}
              unreadRef={msg.eid === firstUnreadEid ? unreadRef : undefined}
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

      {!isAtBottom && unreadCount > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-obsidian z-10"
          style={{
            background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
            boxShadow: "0 4px 16px rgba(245,158,11,0.4), 0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          ↓ {unreadCount} new message{unreadCount !== 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}
