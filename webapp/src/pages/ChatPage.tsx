import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { hotel, hotelActions } from "../context/HotelContext";
import { useCountdown } from "../hooks/useCountdown";
import { useNotifications } from "../hooks/useNotifications";
import { useWebSocket, type WSEventData } from "../hooks/useWebSocket";
import { decrypt, encrypt } from "../lib/crypto";
import { buildDisplayNames } from "../lib/names";
import { getLastSeenEid, setLastSeenEid } from "../lib/lastSeen";
import { ChatHeader } from "../components/chat/ChatHeader";
import { MessageFeed } from "../components/chat/MessageFeed";
import { MessageInput } from "../components/chat/MessageInput";
import { RoomDetailDrawer } from "../components/chat/RoomDetailDrawer";
import { BoostSheet } from "../components/chat/BoostSheet";
import { Spinner } from "../components/shared/Spinner";
import type { PlainRoomInfo } from "../services/RoomService";
import type { RoomService } from "../services/RoomService";
import type { BoostOption } from "../lib/api";

export interface PlainMessage {
  eid: number;
  uid: string | null;
  ts: number;
  text?: string;
  systemType?: "joined" | "left" | "boosted" | "history_gap" | "unread_divider";
  gapCount?: number;
  boostId?: string;
  newExpiresAt?: number;
}

export function ChatPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<RoomService | null>(null);
  const [roomInfo, setRoomInfo] = useState<PlainRoomInfo | null>(null);
  const [messages, setMessages] = useState<PlainMessage[]>([]);
  const [firstUnreadEid, setFirstUnreadEid] = useState<number | undefined>(undefined);
  const maxEidRef = useRef<number>(0);
  const memberNamesRef = useRef<Map<string, string>>(new Map());
  const notifyRef = useRef<(senderName: string, text: string) => void>(() => {});
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [boostSheetOpen, setBoostSheetOpen] = useState(false);

  // Redirect if no session
  useEffect(() => {
    if (!roomId) {
      navigate("/", { replace: true });
      return;
    }
    const s = hotel.getSession(roomId);
    if (!s) {
      navigate("/", { replace: true });
      return;
    }
    setSession(s);
  }, [roomId, navigate]);

  // Load room info + initial events
  useEffect(() => {
    if (!session || !roomId) return;

    const persisted = hotel.listRooms().find((r) => r.roomId === roomId);
    const joinEid = persisted?.joinEid ?? 0;

    (async () => {
      try {
        const [info, rawEvents] = await Promise.all([session.getRoom(), session.getEvents(joinEid)]);
        setRoomInfo(info);

        const decrypted = await Promise.all(
          rawEvents.map(async (ev): Promise<PlainMessage> => {
            if (ev.msg) {
              const text = await decrypt(ev.msg, session.aesKey).catch(() => "[encrypted]");
              return { eid: ev.eid, uid: ev.uid, ts: ev.ts, text };
            }
            return {
              eid: ev.eid,
              uid: ev.uid,
              ts: ev.ts,
              systemType: ev.type as PlainMessage["systemType"],
            };
          }),
        );
        if (decrypted.length > 0) maxEidRef.current = Math.max(...decrypted.map((m) => m.eid));

        const lastSeen = roomId ? getLastSeenEid(roomId) : 0;
        const firstUnread = lastSeen > 0 ? decrypted.find((m) => m.eid > lastSeen) : undefined;
        if (firstUnread) {
          const dividerEid = lastSeen + 0.1;
          const divider: PlainMessage = { eid: dividerEid, uid: null, ts: 0, systemType: "unread_divider" };
          const withDivider = [...decrypted, divider].sort((a, b) => a.eid - b.eid);
          setMessages(withDivider);
          setFirstUnreadEid(dividerEid);
        } else {
          setMessages(decrypted);
        }
      } catch {
        // If we can't load the room, go home
        navigate("/", { replace: true });
      } finally {
        setLoading(false);
      }
    })();
  }, [session, roomId, navigate]);

  // Persist last-seen eid so we can show unread divider on next open
  useEffect(() => {
    if (!roomId) return;
    return () => {
      if (maxEidRef.current > 0) setLastSeenEid(roomId, maxEidRef.current);
    };
  }, [roomId]);

  // WS event handler — decrypt on receive, deduplicate by eid
  // Backend sends events with "event" key: "message:received", "user:joined", "user:left", "boosted"
  const handleWsEvent = useCallback(
    async (raw: WSEventData) => {
      if (!session) return;
      const eid = raw.eid as number;
      const uid = (raw.uid as string | null) ?? null;
      const ts = raw.ts as number;
      const evType = raw.event as string | undefined;

      // Gap detection: if incoming eid is not immediately next, backfill missing events
      if (maxEidRef.current > 0 && eid > maxEidRef.current + 1) {
        try {
          const rawMissed = await session.getEvents(maxEidRef.current);
          const decryptedMissed = await Promise.all(
            rawMissed.map(async (ev): Promise<PlainMessage> => {
              if (ev.msg) {
                const text = await decrypt(ev.msg, session.aesKey).catch(() => "[encrypted]");
                return { eid: ev.eid, uid: ev.uid, ts: ev.ts, text };
              }
              return { eid: ev.eid, uid: ev.uid, ts: ev.ts, systemType: ev.type as PlainMessage["systemType"] };
            }),
          );
          setMessages((prev) => {
            const existingEids = new Set(prev.map((m) => m.eid));
            // Insert gap indicator if server has evicted events
            const extra: PlainMessage[] = [];
            if (rawMissed.length > 0 && rawMissed[0].eid > maxEidRef.current + 1) {
              const gapCount = rawMissed[0].eid - maxEidRef.current - 1;
              const gapEid = maxEidRef.current + 0.5;
              if (!existingEids.has(gapEid)) {
                extra.push({ eid: gapEid, uid: null, ts: 0, systemType: "history_gap", gapCount });
              }
            }
            const newOnes = decryptedMissed.filter((m) => !existingEids.has(m.eid));
            if (extra.length === 0 && newOnes.length === 0) return prev;
            return [...prev, ...extra, ...newOnes].sort((a, b) => a.eid - b.eid);
          });
          for (const m of decryptedMissed) {
            if (m.eid > maxEidRef.current) maxEidRef.current = m.eid;
          }
        } catch {
          // Best-effort; continue to process the current WS event
        }
      }

      let msg: PlainMessage;

      if (evType === "message:received" && raw.msg) {
        const text = await decrypt(raw.msg as string, session.aesKey).catch(() => "[encrypted]");
        if (uid !== session.userId) {
          const senderName = memberNamesRef.current.get(uid ?? "") ?? "Someone";
          notifyRef.current(senderName, text);
        }
        msg = { eid, uid, ts, text };
      } else if (evType === "user:joined") {
        const freshInfo = await session.getRoom().catch(() => null);
        if (freshInfo) setRoomInfo(freshInfo);
        msg = { eid, uid, ts, systemType: "joined" };
      } else if (evType === "user:left") {
        msg = { eid, uid, ts, systemType: "left" };
        setRoomInfo((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            members: prev.members.map((m) => (m.uid === uid ? { ...m, leftAt: ts } : m)),
          };
        });
      } else if (evType === "boosted") {
        msg = {
          eid,
          uid,
          ts,
          systemType: "boosted",
          boostId: raw.boostId as string | undefined,
          newExpiresAt: raw.expiresAt as number | undefined,
        };
        if (raw.expiresAt) {
          setRoomInfo((prev) => (prev ? { ...prev, expiresAt: raw.expiresAt as number } : prev));
        }
      } else {
        return; // unknown event type
      }

      if (eid > maxEidRef.current) maxEidRef.current = eid;
      setMessages((prev) => {
        if (prev.some((m) => m.eid === eid)) return prev;
        return [...prev, msg];
      });
    },
    [session],
  );

  // Backfill missed events when returning to foreground
  useEffect(() => {
    if (!session || !roomId) return;

    async function handleVisibility() {
      if (document.visibilityState !== "visible" || !session) return;
      try {
        const rawEvents = await session.getEvents(maxEidRef.current);
        const decrypted = await Promise.all(
          rawEvents.map(async (ev): Promise<PlainMessage> => {
            if (ev.msg) {
              const text = await decrypt(ev.msg, session.aesKey).catch(() => "[encrypted]");
              return { eid: ev.eid, uid: ev.uid, ts: ev.ts, text };
            }
            return { eid: ev.eid, uid: ev.uid, ts: ev.ts, systemType: ev.type as PlainMessage["systemType"] };
          }),
        );
        setMessages((prev) => {
          const existingEids = new Set(prev.map((m) => m.eid));
          const extra: PlainMessage[] = [];
          if (rawEvents.length > 0 && rawEvents[0].eid > maxEidRef.current + 1) {
            const gapCount = rawEvents[0].eid - maxEidRef.current - 1;
            const gapEid = maxEidRef.current + 0.5;
            if (!existingEids.has(gapEid)) {
              extra.push({ eid: gapEid, uid: null, ts: 0, systemType: "history_gap", gapCount });
            }
          }
          const newOnes = decrypted.filter((m) => !existingEids.has(m.eid));
          if (extra.length === 0 && newOnes.length === 0) return prev;
          return [...prev, ...extra, ...newOnes].sort((a, b) => a.eid - b.eid);
        });
        for (const m of decrypted) {
          if (m.eid > maxEidRef.current) maxEidRef.current = m.eid;
        }
      } catch {
        // Silently ignore — WS delivers future events anyway
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [session, roomId]);

  const { send } = useWebSocket({
    roomId: roomId ?? "",
    onEvent: (ev) => {
      void handleWsEvent(ev);
    },
  });

  async function handleSend(text: string) {
    if (!session) return;
    const encrypted = await encrypt(text, session.aesKey);
    send({ event: "message:send", m: encrypted });
  }

  // Countdown with expiry handler
  const handleExpiry = useCallback(() => {
    if (roomId) hotelActions.removeRoom(roomId);
    navigate("/", { replace: true });
  }, [roomId, navigate]);

  const expiresAtFallback = useMemo(() => Date.now() + 3600_000, []);
  const countdown = useCountdown(roomInfo?.expiresAt ?? expiresAtFallback, handleExpiry);

  // Build member name lookup map with duplicate disambiguation
  const memberNames = buildDisplayNames(roomInfo?.members ?? []);
  memberNamesRef.current = memberNames;

  const { notify } = useNotifications(roomInfo?.name ?? "TempChat");
  notifyRef.current = notify;

  if (loading || !session) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-0 top-0 h-[100dvh] flex flex-col max-w-lg mx-auto bg-obsidian"
    >
      <ChatHeader
        roomName={roomInfo?.name ?? "…"}
        memberCount={roomInfo?.members.filter((m) => !m.leftAt).length ?? 0}
        countdown={countdown}
        onMenuOpen={() => setDrawerOpen(true)}
        onBoost={() => setBoostSheetOpen(true)}
      />

      <MessageFeed
        messages={messages}
        selfUid={session.userId!}
        memberNames={memberNames}
        firstUnreadEid={firstUnreadEid}
      />

      <MessageInput
        onSend={(text) => {
          void handleSend(text);
        }}
      />

      {roomInfo && (
        <RoomDetailDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          roomId={roomId!}
          roomInfo={roomInfo}
          session={session}
          onBoost={() => setBoostSheetOpen(true)}
          memberNames={memberNames}
        />
      )}

      <BoostSheet
        open={boostSheetOpen}
        onClose={() => setBoostSheetOpen(false)}
        onSelect={(_opt: BoostOption) => {
          setBoostSheetOpen(false);
          alert("Boost payment coming soon!");
        }}
      />
    </div>
  );
}
