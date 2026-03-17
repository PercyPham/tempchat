import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RightPanel } from "../shared/RightPanel";
import { QRDisplay } from "../invite/QRDisplay";
import { Spinner } from "../shared/Spinner";
import { hotelActions } from "../../context/HotelContext";
import { leaveRoom } from "../../lib/api";
import { splitDisplayName } from "../../lib/names";
import { RoomService } from "../../services/RoomService";
import type { PlainRoomInfo, PlainMember } from "../../services/RoomService";

interface Props {
  open: boolean;
  onClose: () => void;
  roomId: string;
  roomInfo: PlainRoomInfo;
  session: RoomService;
  onBoost: () => void;
  memberNames: Map<string, string>;
}

export function RoomDetailDrawer({ open, onClose, roomId, roomInfo, session, onBoost, memberNames }: Props) {
  const navigate = useNavigate();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    RoomService.exportPrivateKey(session.privateKey).then((privateKeyJwk) => {
      setInviteUrl(`${window.location.origin}/join/${roomId}#key=${encodeURIComponent(privateKeyJwk)}`);
    });
  }, [open, roomId, session]);

  async function handleCopy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (!inviteUrl) return;
    try {
      await navigator.share({ title: "Join my TempChat room", url: inviteUrl });
    } catch {
      // user cancelled or API unavailable
    }
  }

  async function handleLeave() {
    if (leaving) return;
    setLeaving(true);
    try {
      const token = await session.makeToken(session.userId);
      await leaveRoom(roomId, token);
    } catch {
      // ignore — still remove locally
    }
    hotelActions.removeRoom(roomId);
    navigate("/", { replace: true });
  }

  const isFull = roomInfo.members.length >= roomInfo.maxParticipants;

  const footer = (
    <button
      onClick={() => { void handleLeave(); }}
      disabled={leaving}
      className="flex items-center gap-3 w-full rounded-xl px-4 py-3 transition-colors text-crimson disabled:opacity-50"
      style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.1)" }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-sm">{leaving ? "Leaving…" : "Leave & delete room"}</span>
    </button>
  );

  return (
    <RightPanel open={open} onClose={onClose} title={roomInfo.name} footer={footer}>
      <div className="flex flex-col gap-6">

        {/* Invite section */}
        <div>
          <SectionLabel>Invite</SectionLabel>
          <div className="flex flex-col items-center gap-3">
            {!inviteUrl ? (
              <div className="py-10"><Spinner size={28} /></div>
            ) : (
              <QRDisplay url={inviteUrl} size={160} />
            )}

            {isFull && (
              <p className="text-[10px] text-amber/60 w-full text-center">
                ⚠ Room is full — new joiners will be turned away
              </p>
            )}

            <button
              onClick={() => { void handleCopy(); }}
              disabled={!inviteUrl}
              className="flex items-center gap-2.5 w-full justify-center rounded-2xl py-3 px-4 transition-all active:scale-[0.98] disabled:opacity-40"
              style={{
                background: copied ? "rgba(245,158,11,0.1)" : "rgba(28,35,51,0.8)",
                border: copied ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(255,255,255,0.07)",
                color: copied ? "#F59E0B" : "rgba(249,250,251,0.6)",
              }}
            >
              {copied ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-sm font-medium">Copied!</span>
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="text-sm font-medium">Copy invite link</span>
                </>
              )}
            </button>

            {!!navigator.share && (
              <button
                onClick={() => { void handleShare(); }}
                disabled={!inviteUrl}
                className="flex items-center gap-2.5 w-full justify-center rounded-2xl py-3 px-4 transition-all active:scale-[0.98] disabled:opacity-40"
                style={{
                  background: "rgba(28,35,51,0.8)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  color: "rgba(249,250,251,0.6)",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-sm font-medium">Share invite link</span>
              </button>
            )}
          </div>
        </div>

        {/* Boost section */}
        <div>
          <SectionLabel>Room</SectionLabel>
          <button
            onClick={() => { onClose(); onBoost(); }}
            className={`flex items-center gap-3 w-full rounded-xl px-4 py-3 transition-all hover:scale-[1.01] active:scale-[0.99] ${isFull ? "animate-ember-pulse" : ""}`}
            style={{
              background: "rgba(245,158,11,0.06)",
              border: "1px solid rgba(245,158,11,0.12)",
              color: "#F59E0B",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
              <path d="M13 2L4.5 13.5H11L10 22L19.5 10.5H13L13 2Z" fill="currentColor" />
            </svg>
            <div className="flex flex-col items-start">
              <span className="text-sm">Boost room</span>
              {isFull && (
                <span className="text-[11px] text-warm-white/35">Raise the limit to let more people in</span>
              )}
            </div>
          </button>
        </div>

        {/* Members section */}
        <div>
          <SectionLabel>
            Members · {roomInfo.members.length}/{roomInfo.maxParticipants}
            {isFull && (
              <span className="ml-2 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.15)", color: "#F59E0B" }}>
                Full
              </span>
            )}
          </SectionLabel>
          <div className="flex flex-col gap-1">
            {[...roomInfo.members].sort((a, b) => a.joinedAt - b.joinedAt).map((member: PlainMember) => {
              const hasLeft = !!member.leftAt;
              const displayName = memberNames.get(member.uid) ?? member.name;
              const { base, suffix } = splitDisplayName(displayName);
              return (
                <div
                  key={member.uid}
                  className={`flex items-center gap-3 py-2 px-3 rounded-xl transition-colors ${hasLeft ? "opacity-40" : "hover:bg-white/4"}`}
                >
                  <div
                    className="h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0 font-display font-bold text-sm uppercase"
                    style={
                      hasLeft
                        ? { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(249,250,251,0.4)" }
                        : { background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.12)", color: "#F59E0B" }
                    }
                  >
                    {base.charAt(0)}
                  </div>
                  <span className={`text-sm flex-1 ${hasLeft ? "text-warm-white/50 line-through decoration-warm-white/20" : "text-warm-white"}`}>
                    {base}
                    {suffix && <span className="text-warm-white/30 text-[10px] font-mono">{suffix}</span>}
                  </span>
                  {hasLeft ? (
                    <span className="text-[10px] text-warm-white/30 uppercase tracking-wider">left</span>
                  ) : member.uid === session.userId ? (
                    <span className="text-[10px] text-warm-white/20 uppercase tracking-wider">you</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </RightPanel>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold text-warm-white/25 uppercase tracking-[0.15em] mb-3">
      {children}
    </p>
  );
}
