import { useCallback, useMemo, useState } from "react";
import { BottomSheet } from "../shared/BottomSheet";
import { BoostOptionCard } from "../shared/BoostOptionCard";
import { PurchaseConfirmSheet } from "../shared/PurchaseConfirmSheet";
import { useBoostOptions } from "../../hooks/useBoostOptions";
import { Spinner } from "../shared/Spinner";
import { getUnusedCoupons, removeCoupon, detectPaymentProvider } from "../../lib/payment";
import { redeemCoupon, ApiError } from "../../lib/api";
import type { BoostOption } from "../../lib/api";
import type { StoredCoupon } from "../../lib/payment";
import type { RoomService } from "../../services/RoomService";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (option: BoostOption) => void;
  roomId: string;
  session: RoomService | null;
}

function formatTtl(ms: number): string {
  const hours = ms / (1000 * 60 * 60);
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function BoostSheet({ open, onClose, onSelect, roomId, session }: Props) {
  const { options, loading, error } = useBoostOptions();
  const [coupons, setCoupons] = useState<StoredCoupon[]>(() => getUnusedCoupons());
  const [redeemingCode, setRedeemingCode] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [confirmOption, setConfirmOption] = useState<BoostOption | null>(null);

  const detectedProvider = useMemo(() => detectPaymentProvider(), []);

  const makeToken = useCallback(async () => {
    if (!session) throw new Error("no session");
    return session.makeToken(session.userId);
  }, [session]);

  async function handleApplyCoupon(coupon: StoredCoupon) {
    if (!session || redeemingCode) return;
    setRedeemingCode(coupon.code);
    setRedeemError(null);
    try {
      const token = await session.makeToken(session.userId);
      await redeemCoupon(roomId, coupon.code, token);
      removeCoupon(coupon.code);
      setCoupons((prev) => prev.filter((c) => c.code !== coupon.code));
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.code : "Failed to apply coupon";
      setRedeemError(msg);
      setRedeemingCode(null);
    }
  }

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title="Boost this room">
        <p className="text-warm-white/50 text-sm mb-5">
          Boosts stack additively on the current expiry time and raise participant limits.
        </p>

        {coupons.length > 0 && (
          <div className="mb-6">
            <p className="text-[10px] font-semibold text-warm-white/25 uppercase tracking-[0.15em] mb-3">
              Your coupons
            </p>
            <div className="flex flex-col gap-2">
              {coupons.map((coupon) => (
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
                      `+${formatTtl(coupon.ttlMs)}`,
                      `${coupon.maxParticipants} members`,
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
                    {redeemingCode === coupon.code ? "Applying…" : "Apply to this room"}
                  </button>
                </div>
              ))}
            </div>
            {redeemError && (
              <p className="text-crimson text-xs mt-2">{redeemError}</p>
            )}
            <div className="h-px bg-warm-white/8 my-5" />
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-8"><Spinner /></div>
        )}

        {error && (
          <p className="text-crimson text-sm text-center py-4">Failed to load boost options</p>
        )}

        {!loading && !error && options.length === 0 && (
          <p className="text-warm-white/40 text-sm text-center py-4">No boost options available</p>
        )}

        {!loading && !error && options.length > 0 && (
          <div className="flex flex-col gap-3">
            {options.map((opt) => (
              <BoostOptionCard
                key={opt.id}
                option={opt}
                detectedProvider={detectedProvider}
                onSelect={(o) => setConfirmOption(o)}
              />
            ))}
          </div>
        )}
      </BottomSheet>

      <PurchaseConfirmSheet
        open={!!confirmOption}
        option={confirmOption}
        onClose={() => setConfirmOption(null)}
        onRedirect={() => { setConfirmOption(null); if (confirmOption) onSelect(confirmOption); }}
        makeToken={makeToken}
        roomId={roomId}
      />
    </>
  );
}
