import { useEffect, useRef, useState } from "react";
import { BottomSheet } from "./BottomSheet";
import { Spinner } from "./Spinner";
import { useCountdown } from "../../hooks/useCountdown";
import { getOrderStatus } from "../../lib/api";
import type { CouponData } from "../../lib/api";

interface Props {
  open: boolean;
  qrUrl: string;
  orderId: string;
  amount: number;        // VND amount
  expiresAt: number;     // unix ms
  onClose: () => void;
  onCompleted: () => void;
  onRoomExpired: (coupon: CouponData | undefined) => void;
}

export function SepayQRModal({ open, qrUrl, orderId, amount, expiresAt, onClose, onCompleted, onRoomExpired }: Props) {
  const [copied, setCopied] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdown = useCountdown(expiresAt);

  useEffect(() => {
    if (!open) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }

    pollingRef.current = setInterval(() => {
      getOrderStatus(orderId)
        .then((status) => {
          if (status.status === "completed") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            onCompleted();
          } else if (status.status === "room_expired") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            onRoomExpired(status.coupon);
          }
        })
        .catch(() => {}); // polling errors are silent
    }, 3000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [open, orderId, onCompleted, onRoomExpired]);

  function handleCopy() {
    void navigator.clipboard.writeText(orderId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Scan to pay">
      {/* Amount */}
      <p className="text-warm-white/50 text-sm mb-5 text-center">
        Transfer exactly{" "}
        <span className="font-display font-bold text-warm-white">
          {amount.toLocaleString("vi-VN")} ₫
        </span>{" "}
        with the reference below.
      </p>

      {/* QR code */}
      <div className="flex justify-center mb-5">
        <div className="rounded-2xl overflow-hidden bg-white p-3" style={{ width: 220, height: 220 }}>
          <img src={qrUrl} alt="SePay QR code" className="w-full h-full object-contain" />
        </div>
      </div>

      {/* Reference / orderId */}
      <button
        onClick={handleCopy}
        className="w-full flex items-center justify-between rounded-xl px-4 py-3 mb-5 text-sm transition-all active:scale-[0.98]"
        style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}
      >
        <span className="text-warm-white/50 text-xs">Payment reference</span>
        <span className="flex items-center gap-2 text-warm-white font-mono text-xs">
          {orderId}
          <span className="text-warm-white/30">
            {copied ? "✓ Copied" : "Copy"}
          </span>
        </span>
      </button>

      {/* Countdown */}
      {!countdown.expired && (
        <p className="text-warm-white/30 text-xs text-center mb-4">
          Expires in{" "}
          <span className={countdown.urgency === "urgent" ? "text-crimson" : "text-warm-white/60"}>
            {countdown.label}
          </span>
        </p>
      )}

      {/* Waiting indicator */}
      <div className="flex items-center justify-center gap-3 py-3 mb-5">
        <Spinner size={16} />
        <span className="text-warm-white/40 text-sm">Waiting for confirmation…</span>
      </div>

      {/* Dismiss */}
      <button
        onClick={onClose}
        className="w-full text-center text-warm-white/25 text-xs hover:text-warm-white/50 transition-colors py-2"
      >
        Dismiss (payment stays active)
      </button>
    </BottomSheet>
  );
}
