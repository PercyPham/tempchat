import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { hotel, hotelActions } from "../context/HotelContext";
import { useCountdown } from "../hooks/useCountdown";
import { useWebSocket, type WSEventData } from "../hooks/useWebSocket";
import { decryptMessage, encryptMessage } from "../lib/crypto";
import { buildDisplayNames } from "../lib/names";
import { ChatHeader } from "../components/chat/ChatHeader";
import { MessageFeed } from "../components/chat/MessageFeed";
import { MessageInput } from "../components/chat/MessageInput";
import { StatusPill } from "../components/chat/StatusPill";
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
  systemType?: "joined" | "left" | "boosted";
  boostId?: string;
  newExpiresAt?: number;
}

export function ChatPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<RoomService | null>(null);
  const [roomInfo, setRoomInfo] = useState<PlainRoomInfo | null>(null);
  const [messages, setMessages] = useState<PlainMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [boostSheetOpen, setBoostSheetOpen] = useState(false);

  // Redirect if no session
  useEffect(() => {
    if (!roomId) { navigate("/", { replace: true }); return; }
    const s = hotel.getSession(roomId);
    if (!s) { navigate("/", { replace: true }); return; }
    setSession(s);
  }, [roomId, navigate]);

  // Load room info + initial events
  useEffect(() => {
    if (!session || !roomId) return;

    const persisted = hotel.listRooms().find((r) => r.roomId === roomId);
    const joinEid = persisted?.joinEid ?? 0;

    (async () => {
      try {
        const [info, rawEvents] = await Promise.all([
          session.getRoom(),
          session.getEvents(joinEid),
        ]);
        setRoomInfo(info);

        const decrypted = await Promise.all(
          rawEvents.map(async (ev): Promise<PlainMessage> => {
            if (ev.msg) {
              const text = await decryptMessage(ev.msg, session.secret).catch(() => "[encrypted]");
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
        setMessages(decrypted);
      } catch {
        // If we can't load the room, go home
        navigate("/", { replace: true });
      } finally {
        setLoading(false);
      }
    })();
  }, [session, roomId, navigate]);

  // WS event handler — decrypt on receive, deduplicate by eid
  // Backend sends events with "event" key: "message:received", "user:joined", "user:left", "boosted"
  const handleWsEvent = useCallback(async (raw: WSEventData) => {
    if (!session) return;
    const eid = raw.eid as number;
    const uid = (raw.uid as string | null) ?? null;
    const ts = raw.ts as number;
    const evType = raw.event as string | undefined;

    let msg: PlainMessage;

    if (evType === "message:received" && raw.msg) {
      const text = await decryptMessage(raw.msg as string, session.secret).catch(() => "[encrypted]");
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
          members: prev.members.map((m) =>
            m.uid === uid ? { ...m, leftAt: ts } : m,
          ),
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
        setRoomInfo((prev) => prev ? { ...prev, expiresAt: raw.expiresAt as number } : prev);
      }
    } else {
      return; // unknown event type
    }

    setMessages((prev) => {
      if (prev.some((m) => m.eid === eid)) return prev;
      return [...prev, msg];
    });
  }, [session]);

  const { send } = useWebSocket({
    roomId: roomId ?? "",
    onEvent: (ev) => { void handleWsEvent(ev); },
  });

  async function handleSend(text: string) {
    if (!session) return;
    const encrypted = await encryptMessage(text, session.secret);
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

  if (loading || !session) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto">
      <ChatHeader
        roomName={roomInfo?.name ?? "…"}
        memberCount={roomInfo?.members.filter((m) => !m.leftAt).length ?? 0}
        countdown={countdown}
        onMenuOpen={() => setDrawerOpen(true)}
      />

      <MessageFeed
        messages={messages}
        selfUid={session.userId!}
        memberNames={memberNames}
      />

      <MessageInput onSend={(text) => { void handleSend(text); }} />

      <StatusPill countdown={countdown} onBoost={() => setBoostSheetOpen(true)} />

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
