import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { hotel } from "../context/HotelContext";
import { RoomService } from "../services/RoomService";
import { QRDisplay } from "../components/invite/QRDisplay";
import { Spinner } from "../components/shared/Spinner";

export function InvitePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    const session = hotel.getSession(roomId);
    if (!session) { navigate("/", { replace: true }); return; }
    RoomService.exportSecret(session.secret).then((secretB64url) => {
      setInviteUrl(`${window.location.origin}/join/${roomId}#${secretB64url}`);
    });
  }, [roomId, navigate]);

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

  return (
    <div className="max-w-lg mx-auto px-5 pt-10 pb-24 animate-fade-in">
      <button
        onClick={() => navigate(`/chat/${roomId}`)}
        className="flex items-center gap-2 text-warm-white/30 hover:text-warm-white/70 mb-10 transition-colors text-sm"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M19 12H5M5 12l7 7M5 12l7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to chat
      </button>

      <div className="mb-8">
        <h1 className="font-display text-3xl font-extrabold text-warm-white leading-tight mb-2">
          Invite someone
        </h1>
        <p className="text-warm-white/35 text-sm">
          The encryption key is embedded in the link's hash — it never touches the server.
        </p>
      </div>

      {!inviteUrl ? (
        <div className="flex justify-center py-20"><Spinner size={32} /></div>
      ) : (
        <div className="flex flex-col items-center gap-6">
          <QRDisplay url={inviteUrl} />

          <button
            onClick={() => { void handleCopy(); }}
            className="flex items-center gap-2.5 w-full justify-center rounded-2xl py-3.5 px-5 transition-all active:scale-[0.98]"
            style={{
              background: copied ? "rgba(245,158,11,0.1)" : "rgba(28,35,51,0.8)",
              border: copied ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(255,255,255,0.07)",
              color: copied ? "#F59E0B" : "rgba(249,250,251,0.6)",
            }}
          >
            {copied ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-sm font-medium">Copied to clipboard</span>
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
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
              className="flex items-center gap-2.5 w-full justify-center rounded-2xl py-3.5 px-5 transition-all active:scale-[0.98]"
              style={{
                background: "rgba(28,35,51,0.8)",
                border: "1px solid rgba(255,255,255,0.07)",
                color: "rgba(249,250,251,0.6)",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-sm font-medium">Share invite link</span>
            </button>
          )}

          <button
            onClick={() => navigate(`/chat/${roomId}`)}
            className="flex items-center gap-2.5 w-full justify-center rounded-2xl py-3.5 px-5 transition-all active:scale-[0.97] mt-2"
            style={{
              background: "#F59E0B",
              color: "#0D0F14",
            }}
          >
            <span className="text-sm font-semibold">Go to chat</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
