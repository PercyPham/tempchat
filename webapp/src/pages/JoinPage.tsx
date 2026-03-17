import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { hotel, hotelActions } from "../context/HotelContext";
import { RoomService } from "../services/RoomService";
import { ApiError } from "../lib/api";
import { useBoostOptions } from "../hooks/useBoostOptions";
import { BoostOptionCard } from "../components/shared/BoostOptionCard";
import { Spinner } from "../components/shared/Spinner";
import type { BoostOption } from "../lib/api";

type Phase = "extracting" | "name" | "joining" | "full" | "boost" | "error";

export function JoinPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("extracting");
  const [secret, setSecret] = useState<CryptoKey | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [roomMaxParticipants, setRoomMaxParticipants] = useState<number | null>(null);

  useEffect(() => {
    if (!roomId) { navigate("/", { replace: true }); return; }

    // If already joined, go to chat
    if (hotel.getSession(roomId)) {
      navigate(`/chat/${roomId}`, { replace: true });
      return;
    }

    const secretB64url = window.location.hash.slice(1);
    if (!secretB64url) {
      setPhase("error");
      setErrorMsg("Invalid invite link — no encryption key found in URL.");
      return;
    }

    RoomService.importSecret(secretB64url)
      .then(async (key) => {
        // Clear hash now that we've read it — key is no longer needed in the URL
        history.replaceState(null, "", window.location.pathname);
        setSecret(key);
        // Pre-check room capacity before showing name input
        const rs = await RoomService.fromSecret(key);
        rs.roomId = roomId;
        const room = await rs.getRoom();
        setRoomMaxParticipants(room.maxParticipants);
        if (room.memberCount >= room.maxParticipants) {
          setPhase("full");
        } else {
          setPhase("name");
        }
      })
      .catch(() => { setPhase("error"); setErrorMsg("Could not read encryption key from link."); });
  }, [roomId, navigate]);

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!roomId || !secret || !displayName.trim()) return;
    setPhase("joining");
    try {
      await hotelActions.joinRoom(secret, roomId, { name: displayName.trim() });
      navigate(`/chat/${roomId}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "room_full") {
        // Race condition — room filled between pre-check and join; re-fetch room info
        try {
          const rs = await RoomService.fromSecret(secret);
          rs.roomId = roomId;
          const room = await rs.getRoom();
          setRoomMaxParticipants(room.maxParticipants);
        } catch {
          // If getRoom fails, show full screen with null max (RoomFullPage handles gracefully)
        }
        setPhase("full");
      } else {
        setPhase("error");
        setErrorMsg(err instanceof Error ? err.message : "Failed to join room");
      }
    }
  }

  if (phase === "extracting" || phase === "joining") {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-4">
        <Spinner size={32} />
        <p className="text-warm-white/30 text-sm">
          {phase === "extracting" ? "Reading invite…" : "Joining room…"}
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="max-w-lg mx-auto px-5 pt-20 pb-24 text-center animate-fade-in">
        <div className="relative inline-block mb-6">
          <div className="absolute inset-0 rounded-2xl blur-xl opacity-30" style={{ background: "rgba(239,68,68,0.5)" }} />
          <div className="relative rounded-2xl p-5" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-crimson">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>
        <h1 className="font-display text-2xl font-bold text-warm-white mb-2">Invalid invite</h1>
        <p className="text-warm-white/40 text-sm mb-8">{errorMsg}</p>
        <button onClick={() => navigate("/")} className="text-amber/70 hover:text-amber transition-colors text-sm">
          ← Go home
        </button>
      </div>
    );
  }

  if (phase === "full") {
    return (
      <RoomFullPage
        roomMaxParticipants={roomMaxParticipants}
        onBoostSelect={() => setPhase("boost")}
      />
    );
  }

  if (phase === "boost") {
    return <BoostConstructionPage onBack={() => setPhase("full")} />;
  }

  return (
    <div className="max-w-lg mx-auto px-5 pt-16 pb-24 animate-slide-up">
      {/* Icon */}
      <div className="mb-8">
        <div
          className="inline-flex h-14 w-14 rounded-2xl items-center justify-center mb-5"
          style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.15)" }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="text-amber">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="font-display text-3xl font-extrabold text-warm-white mb-1.5">Join the room</h1>
        <p className="text-warm-white/35 text-sm">Pick a name — it's encrypted before being stored.</p>
      </div>

      <form onSubmit={(e) => { void handleJoin(e); }} className="flex flex-col gap-5">
        <div>
          <label className="block text-[10px] font-semibold text-warm-white/30 uppercase tracking-[0.15em] mb-2" htmlFor="displayName">
            Your name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Bob"
            maxLength={32}
            autoFocus
            className="w-full rounded-2xl px-4 py-3.5 text-warm-white placeholder-warm-white/20 text-sm focus:outline-none transition-all"
            style={{
              background: "rgba(28,35,51,0.6)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
            onFocus={(e) => {
              e.currentTarget.style.border = "1px solid rgba(245,158,11,0.4)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(245,158,11,0.08)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.border = "1px solid rgba(255,255,255,0.07)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>

        <button
          type="submit"
          disabled={!displayName.trim()}
          className="rounded-2xl py-4 font-display font-bold text-obsidian text-base transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
            boxShadow: displayName.trim() ? "0 0 20px rgba(245,158,11,0.3), 0 4px 12px rgba(0,0,0,0.3)" : "none",
          }}
        >
          Join room →
        </button>
      </form>
    </div>
  );
}

interface RoomFullPageProps {
  roomMaxParticipants: number | null;
  onBoostSelect: (opt: BoostOption) => void;
}

function RoomFullPage({ roomMaxParticipants, onBoostSelect }: RoomFullPageProps) {
  const navigate = useNavigate();
  const { options, loading } = useBoostOptions();

  const applicable = roomMaxParticipants !== null
    ? options.filter((o) => o.maxParticipants > roomMaxParticipants)
    : options; // unknown max — show all as fallback

  return (
    <div className="max-w-lg mx-auto px-5 pt-16 pb-24 animate-slide-up">
      <div className="text-center mb-8">
        <div
          className="inline-flex rounded-2xl p-5 mb-5"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)" }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-amber">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M20 8v6M23 11h-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="font-display text-2xl font-bold text-warm-white mb-2">Room is full</h1>
        {loading ? null : applicable.length > 0 ? (
          <p className="text-warm-white/40 text-sm max-w-xs mx-auto">
            Boost the room to raise the participant limit and join.
          </p>
        ) : (
          <p className="text-warm-white/40 text-sm max-w-xs mx-auto">
            This room is at maximum capacity.
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : applicable.length > 0 ? (
        <div className="flex flex-col gap-3 mb-8">
          <p className="text-[10px] font-semibold text-warm-white/25 uppercase tracking-[0.15em] mb-1">Available boosts</p>
          {applicable.map((opt) => (
            <BoostOptionCard key={opt.id} option={opt} onSelect={onBoostSelect} />
          ))}
        </div>
      ) : null}

      <button onClick={() => navigate("/")} className="w-full text-center text-warm-white/25 text-xs hover:text-warm-white/50 transition-colors">
        ← Go home
      </button>
    </div>
  );
}

function BoostConstructionPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="max-w-lg mx-auto px-5 pt-20 pb-24 text-center animate-fade-in">
      <div className="relative inline-block mb-6">
        <div className="absolute inset-0 rounded-2xl blur-xl opacity-20" style={{ background: "rgba(245,158,11,0.5)" }} />
        <div className="relative rounded-2xl p-5" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-amber">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <h1 className="font-display text-2xl font-bold text-warm-white mb-2">Under Construction</h1>
      <p className="text-warm-white/40 text-sm mb-8">Boost payments are coming soon.</p>
      <button onClick={onBack} className="text-amber/70 hover:text-amber transition-colors text-sm">
        ← Go back
      </button>
    </div>
  );
}
