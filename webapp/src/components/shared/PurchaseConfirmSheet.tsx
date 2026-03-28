import { useCallback, useEffect, useRef, useState } from "react";
import { BottomSheet } from "./BottomSheet";
import { Spinner } from "./Spinner";
import { detectPaymentProvider } from "../../lib/payment";
import { initiatePayment, getOrderStatus, ApiError } from "../../lib/api";
import { saveCoupon } from "../../lib/payment";
import type { BoostOption } from "../../lib/api";

interface Props {
  open: boolean;
  option: BoostOption | null;
  onClose: () => void;
  onRedirect: () => void;
  makeToken: () => Promise<string>;
  roomId: string;
}

type Provider = "sepay" | "polar";

interface SePayQRData {
  orderId: string;
  amountVnd: number;
  accountNumber: string;
  bankCode: string;
  bankName: string;
}

function formatTtl(ms: number): string {
  const hours = ms / (1000 * 60 * 60);
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatVnd(vnd: number): string {
  return vnd.toLocaleString("vi-VN") + " ₫";
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-warm-white/6 last:border-0">
      <div>
        <p className="text-[10px] font-semibold text-warm-white/30 uppercase tracking-[0.12em] mb-0.5">{label}</p>
        <p className="text-sm font-mono text-warm-white/80">{value}</p>
      </div>
      <button
        onClick={handleCopy}
        className="text-xs font-semibold px-3 py-1.5 rounded-xl transition-all active:scale-95"
        style={{
          background: copied ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.06)",
          color: copied ? "rgba(34,197,94,0.9)" : "rgba(255,255,255,0.4)",
          border: copied ? "1px solid rgba(34,197,94,0.2)" : "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function PurchaseConfirmSheet({ open, option, onClose, onRedirect, makeToken, roomId }: Props) {
  const [provider, setProvider] = useState<Provider>(() => detectPaymentProvider());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"confirm" | "qr">("confirm");
  const [qrData, setQrData] = useState<SePayQRData | null>(null);
  const [pollStatus, setPollStatus] = useState<"waiting" | "done">("waiting");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state when sheet opens/closes
  useEffect(() => {
    if (open) {
      setProvider(detectPaymentProvider());
      setError(null);
      setLoading(false);
      setStep("confirm");
      setQrData(null);
      setPollStatus("waiting");
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [open]);

  // Start polling when QR step is active
  useEffect(() => {
    if (step !== "qr" || !qrData) return;

    pollRef.current = setInterval(() => {
      void getOrderStatus(qrData.orderId).then((res) => {
        if (res.status === "completed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setPollStatus("done");
          setTimeout(() => onRedirect(), 800);
        } else if (res.status === "room_expired") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          if (res.coupon) {
            saveCoupon({
              code: res.coupon.code,
              boostName: res.coupon.boostName,
              ttlMs: res.coupon.ttlMs,
              maxParticipants: res.coupon.maxParticipants,
              maxEvents: res.coupon.maxEvents,
              expiresAt: res.coupon.expiresAt,
            });
          }
          setPollStatus("done");
          setTimeout(() => onRedirect(), 800);
        }
      });
    }, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [step, qrData, onRedirect]);

  const handleConfirm = useCallback(async () => {
    if (!option || loading) return;
    setLoading(true);
    setError(null);
    try {
      const token = await makeToken();
      const result = await initiatePayment({ roomId, boostId: option.id, provider }, token);
      if (result.provider === "sepay") {
        setQrData({
          orderId: result.orderId,
          amountVnd: result.amountVnd,
          accountNumber: result.accountNumber,
          bankCode: result.bankCode,
          bankName: result.bankName,
        });
        setStep("qr");
        setLoading(false);
      } else {
        window.location.href = result.checkoutUrl;
        onRedirect();
        // intentionally leave loading=true — sheet closes before reset
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "Failed to start payment");
      setLoading(false);
    }
  }, [option, loading, makeToken, roomId, provider, onRedirect]);

  if (!option) return null;

  const tags = [`+${formatTtl(option.ttlMs)}`, `${option.maxParticipants} members`, `${option.maxEvents} events`];

  if (step === "qr" && qrData) {
    const qrUrl = `https://img.vietqr.io/image/${qrData.bankCode}-${qrData.accountNumber}-qr_only.png?amount=${qrData.amountVnd}&addInfo=${encodeURIComponent(qrData.orderId)}`;

    return (
      <BottomSheet open={open} onClose={onClose} title="Bank Transfer">
        {/* QR code + bank info — centered together so text aligns under the QR */}
        <div className="flex flex-col items-center gap-4 mb-5">
          <div className="rounded-2xl p-3" style={{ background: "#fff" }}>
            <img src={qrUrl} alt="VietQR payment code" width={200} height={200} className="block" />
          </div>

          {/* Bank info */}
          <div
            className="w-full max-w-70 rounded-2xl px-4 pt-1 pb-1"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            {qrData.bankName && (
              <div className="py-2.5 border-b border-warm-white/6">
                <p className="text-[10px] font-semibold text-warm-white/30 uppercase tracking-[0.12em] mb-0.5">Bank</p>
                <p className="text-sm text-warm-white/80">{qrData.bankName}</p>
              </div>
            )}
            <CopyRow label="Account Number" value={qrData.accountNumber} />
            <CopyRow label="Transfer Content" value={qrData.orderId} />
            <div className="py-2.5">
              <p className="text-[10px] font-semibold text-warm-white/30 uppercase tracking-[0.12em] mb-0.5">Amount</p>
              <p className="text-sm font-semibold" style={{ color: "rgba(245,158,11,0.9)" }}>
                {formatVnd(qrData.amountVnd)}
              </p>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center justify-center gap-2 py-3">
          {pollStatus === "done" ? (
            <p className="text-sm font-semibold" style={{ color: "rgba(34,197,94,0.9)" }}>
              Payment confirmed!
            </p>
          ) : (
            <>
              <Spinner size={14} />
              <p className="text-xs text-warm-white/40">Waiting for payment…</p>
            </>
          )}
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Complete Purchase">
      {/* Boost summary */}
      <div
        className="rounded-2xl p-4 mb-6"
        style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0"
            style={{ color: "rgba(245,158,11,0.8)" }}
          >
            <path
              d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-display font-bold text-warm-white text-base">{option.name}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="text-xs bg-warm-white/8 text-warm-white/50 rounded-full px-2.5 py-1">
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Payment method label */}
      <p className="text-[10px] font-semibold text-warm-white/25 uppercase tracking-[0.15em] mb-3">Payment Method</p>

      {/* Provider toggle */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {(["polar", "sepay"] as Provider[]).map((p) => {
          const selected = provider === p;
          const isGlobal = p === "polar";
          return (
            <button
              key={p}
              onClick={() => setProvider(p)}
              disabled={loading}
              className="rounded-2xl p-4 text-left transition-all active:scale-[0.98] disabled:opacity-50"
              style={
                selected
                  ? {
                      border: "1.5px solid rgba(245,158,11,0.7)",
                      background: "rgba(245,158,11,0.08)",
                      boxShadow: "0 0 0 3px rgba(245,158,11,0.12)",
                    }
                  : {
                      border: "1px solid rgba(255,255,255,0.07)",
                      background: "rgba(255,255,255,0.03)",
                    }
              }
            >
              <div className="text-xl mb-1.5">{isGlobal ? "🌍" : "🇻🇳"}</div>
              <p
                className={`font-display font-bold text-sm mb-0.5 ${selected ? "text-warm-white" : "text-warm-white/60"}`}
              >
                {isGlobal ? "Global" : "Vietnam"}
              </p>
              <p className={`text-xs mb-3 ${selected ? "text-warm-white/50" : "text-warm-white/30"}`}>
                {isGlobal ? "Card, PayPal" : "Bank Transfer"}
              </p>
              <p
                className={`font-display font-bold text-sm leading-none ${selected ? "text-amber" : "text-warm-white/30"}`}
              >
                {isGlobal ? formatUsd(option.priceUsdCents) : formatVnd(option.priceVnd)}
              </p>
            </button>
          );
        })}
      </div>

      {error && <p className="text-crimson text-xs text-center mb-4">{error}</p>}

      {/* Action row */}
      <div className="flex gap-3">
        <button
          onClick={onClose}
          disabled={loading}
          className="flex-1 rounded-2xl py-4 font-semibold text-warm-white/50 hover:text-warm-white/70 transition-colors text-sm disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            void handleConfirm();
          }}
          disabled={loading}
          className="flex-2 rounded-2xl py-4 font-display font-bold text-obsidian text-base transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{
            background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
            boxShadow: loading ? "none" : "0 0 20px rgba(245,158,11,0.3), 0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {loading ? <Spinner size={18} /> : "Continue →"}
        </button>
      </div>
    </BottomSheet>
  );
}
