import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { hotel, hotelActions } from "../context/HotelContext";
import { RoomService } from "../services/RoomService";
import { ApiError, redeemCoupon, getOrderStatus } from "../lib/api";
import { getUnusedCoupons, removeCoupon, saveCoupon, detectPaymentProvider } from "../lib/payment";
import { useBoostOptions } from "../hooks/useBoostOptions";
import { BoostOptionCard } from "../components/shared/BoostOptionCard";
import { PurchaseConfirmSheet } from "../components/shared/PurchaseConfirmSheet";
import { Spinner } from "../components/shared/Spinner";
import type { BoostOption } from "../lib/api";
import type { StoredCoupon } from "../lib/payment";

type Phase = "extracting" | "name" | "joining" | "full" | "error";

export function JoinPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [phase, setPhase] = useState<Phase>("extracting");
  const [secret, setSecret] = useState<CryptoKey | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [roomMaxParticipants, setRoomMaxParticipants] = useState<number | null>(null);
  const [roomMemberCount, setRoomMemberCount] = useState<number | null>(null);

  // Track whether we're polling for a Polar order completion
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!roomId) { navigate("/", { replace: true }); return; }

    // If already joined, go to chat (preserve orderId for post-payment polling there)
    if (hotel.getSession(roomId)) {
      const orderId = searchParams.get("orderId");
      navigate(orderId ? `/chat/${roomId}?orderId=${orderId}` : `/chat/${roomId}`, { replace: true });
      return;
    }

    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const privateKeyJwk = hashParams.get("key");

    // No key in hash — may be returning from Polar checkout with ?orderId=
    if (!privateKeyJwk) {
      const orderId = searchParams.get("orderId");
      if (orderId) {
        // We're back from Polar but don't have the crypto key. Show error.
        setPhase("error");
        setErrorMsg("Invite link expired. Please ask for a new invite to join.");
        return;
      }
      setPhase("error");
      setErrorMsg("Invalid invite link — no encryption key found in URL.");
      return;
    }

    RoomService.importPrivateKey(privateKeyJwk)
      .then(async (key) => {
        // Clear hash now that we've read it
        history.replaceState(null, "", window.location.pathname + window.location.search);
        setSecret(key);
        const rs = await RoomService.fromPrivateKey(key);
        rs.roomId = roomId;
        const room = await rs.getRoom();
        setRoomMaxParticipants(room.maxParticipants);
        setRoomMemberCount(room.memberCount);
        if (room.memberCount >= room.maxParticipants) {
          setPhase("full");
        } else {
          setPhase("name");
        }
      })
      .catch(() => { setPhase("error"); setErrorMsg("Could not read encryption key from link."); });
  }, [roomId, navigate, searchParams]);

  // Poll for Polar order completion when ?orderId= is present
  useEffect(() => {
    const orderId = searchParams.get("orderId");
    if (!orderId || phase !== "full" || !secret || !roomId) return;

    pollingRef.current = setInterval(() => {
      getOrderStatus(orderId)
        .then(async (status) => {
          if (status.status === "pending") return;
          clearInterval(pollingRef.current!);
          setSearchParams((prev) => { prev.delete("orderId"); return prev; }, { replace: true });

          if (status.status === "completed") {
            // Room was boosted — re-fetch and attempt join
            try {
              const rs = await RoomService.fromPrivateKey(secret);
              rs.roomId = roomId;
              const room = await rs.getRoom();
              setRoomMaxParticipants(room.maxParticipants);
              setRoomMemberCount(room.memberCount);
              if (room.memberCount < room.maxParticipants) {
                setPhase("name");
              }
            } catch {
              setPhase("name"); // optimistic: try to join
            }
          } else if (status.status === "room_expired" && status.coupon) {
            saveCoupon(status.coupon);
            // Stay on full page — coupon will appear in wallet
          }
        })
        .catch(() => {});
    }, 3000);

    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [searchParams, phase, secret, roomId, setSearchParams]);

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!roomId || !secret || !displayName.trim()) return;
    setPhase("joining");
    try {
      await hotelActions.joinRoom(secret, roomId, { name: displayName.trim() });
      navigate(`/chat/${roomId}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "room_full") {
        try {
          const rs = await RoomService.fromPrivateKey(secret);
          rs.roomId = roomId;
          const room = await rs.getRoom();
          setRoomMaxParticipants(room.maxParticipants);
          setRoomMemberCount(room.memberCount);
        } catch {
          // ignore
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
        roomId={roomId!}
        roomMaxParticipants={roomMaxParticipants}
        roomMemberCount={roomMemberCount}
        secret={secret}
        onCouponApplied={() => setPhase("name")}
      />
    );
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
            autoComplete="shouldnotautocomplete"
            className="w-full rounded-2xl px-4 py-3.5 text-warm-white placeholder-warm-white/20 text-sm focus:outline-none transition-all"
            style={{
              background: "var(--tc-input-bg)",
              border: "1px solid var(--tc-input-border)",
              fontSize: "16px",
            }}
            onFocus={(e) => {
              e.currentTarget.style.border = "1px solid rgba(245,158,11,0.4)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(245,158,11,0.08)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.border = "1px solid var(--tc-input-border)";
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
  roomId: string;
  roomMaxParticipants: number | null;
  roomMemberCount: number | null;
  secret: CryptoKey | null;
  onCouponApplied: () => void;
}

function RoomFullPage({ roomId, roomMaxParticipants, roomMemberCount, secret, onCouponApplied }: RoomFullPageProps) {
  const navigate = useNavigate();
  const { options, loading } = useBoostOptions();

  const applicable = roomMaxParticipants !== null
    ? options.filter((o) => o.maxParticipants > roomMaxParticipants)
    : options;

  const eligibleCoupons = getUnusedCoupons().filter((c) => roomMemberCount !== null ? c.maxParticipants > roomMemberCount : true);

  const [redeemingCode, setRedeemingCode] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [confirmOption, setConfirmOption] = useState<BoostOption | null>(null);

  const detectedProvider = useMemo(() => detectPaymentProvider(), []);

  const makeToken = useCallback(async () => {
    if (!secret) throw new Error("no secret");
    const rs = await RoomService.fromPrivateKey(secret);
    rs.roomId = roomId;
    return rs.makeToken(null); // non-member
  }, [secret, roomId]);

  async function handleApplyCoupon(coupon: StoredCoupon) {
    if (!secret || redeemingCode) return;
    setRedeemingCode(coupon.code);
    setRedeemError(null);
    try {
      const rs = await RoomService.fromPrivateKey(secret);
      rs.roomId = roomId;
      const token = await rs.makeToken(null); // uid=null: non-member
      await redeemCoupon(roomId, coupon.code, token);
      removeCoupon(coupon.code);
      onCouponApplied();
    } catch (err) {
      const msg = err instanceof ApiError ? err.code : "Failed to apply coupon";
      setRedeemError(msg);
      setRedeemingCode(null);
    }
  }

  return (
    <>
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
          {loading ? null : applicable.length > 0 || eligibleCoupons.length > 0 ? (
            <p className="text-warm-white/40 text-sm max-w-xs mx-auto">
              Boost the room to raise the participant limit and join.
            </p>
          ) : (
            <p className="text-warm-white/40 text-sm max-w-xs mx-auto">
              This room is at maximum capacity.
            </p>
          )}
        </div>

        {eligibleCoupons.length > 0 && (
          <div className="mb-6">
            <p className="text-[10px] font-semibold text-warm-white/25 uppercase tracking-[0.15em] mb-3">
              Your coupons
            </p>
            <div className="flex flex-col gap-2">
              {eligibleCoupons.map((coupon) => (
                <div
                  key={coupon.code}
                  className="rounded-2xl p-4"
                  style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <span className="font-display font-bold text-warm-white text-sm">{coupon.boostName}</span>
                    <span className="text-xs text-warm-white/30">
                      Expires {new Date(coupon.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {[
                      `up to ${coupon.maxParticipants} members`,
                      `${coupon.maxEvents} events`,
                    ].map((tag) => (
                      <span key={tag} className="text-xs bg-warm-white/8 text-warm-white/40 rounded-full px-2.5 py-1">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => void handleApplyCoupon(coupon)}
                    disabled={!!redeemingCode}
                    className="w-full rounded-xl py-2.5 text-sm font-semibold text-obsidian transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)" }}
                  >
                    {redeemingCode === coupon.code ? "Applying…" : "Apply coupon to join"}
                  </button>
                </div>
              ))}
            </div>
            {redeemError && (
              <p className="text-crimson text-xs mt-2">{redeemError}</p>
            )}
            {applicable.length > 0 && <div className="h-px bg-warm-white/8 my-5" />}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : applicable.length > 0 ? (
          <div className="flex flex-col gap-3 mb-8">
            <p className="text-[10px] font-semibold text-warm-white/25 uppercase tracking-[0.15em] mb-1">Available boosts</p>
            {applicable.map((opt) => (
              <BoostOptionCard
                key={opt.id}
                option={opt}
                detectedProvider={detectedProvider}
                onSelect={(o) => setConfirmOption(o)}
              />
            ))}
          </div>
        ) : null}

        <button onClick={() => navigate("/")} className="w-full text-center text-warm-white/25 text-xs hover:text-warm-white/50 transition-colors">
          ← Go home
        </button>
      </div>

      <PurchaseConfirmSheet
        open={!!confirmOption}
        option={confirmOption}
        onClose={() => setConfirmOption(null)}
        onRedirect={() => setConfirmOption(null)}
        makeToken={makeToken}
        roomId={roomId}
      />
    </>
  );
}
