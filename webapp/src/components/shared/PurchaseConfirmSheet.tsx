import { useCallback, useEffect, useState } from "react";
import { BottomSheet } from "./BottomSheet";
import { Spinner } from "./Spinner";
import { detectPaymentProvider, buildSePayFormFields, sepayCheckoutUrl } from "../../lib/payment";
import { initiatePayment, ApiError } from "../../lib/api";
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

function submitSePayForm(checkoutUrl: string, formFields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = checkoutUrl;
  for (const [k, v] of Object.entries(formFields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export function PurchaseConfirmSheet({ open, option, onClose, onRedirect, makeToken, roomId }: Props) {
  const [provider, setProvider] = useState<Provider>(() => detectPaymentProvider());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setProvider(detectPaymentProvider());
      setError(null);
      setLoading(false);
    }
  }, [open]);

  const handleConfirm = useCallback(async () => {
    if (!option || loading) return;
    setLoading(true);
    setError(null);
    try {
      const token = await makeToken();
      const result = await initiatePayment({ roomId, boostId: option.id, provider }, token);
      if (result.provider === "sepay") {
        const formFields = await buildSePayFormFields({
          orderId: result.orderId,
          amountVnd: result.amountVnd,
          roomId,
        });
        submitSePayForm(sepayCheckoutUrl(), formFields);
      } else {
        window.location.href = result.checkoutUrl;
      }
      onRedirect();
      // intentionally leave loading=true — sheet closes before reset
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "Failed to start payment");
      setLoading(false);
    }
  }, [option, loading, makeToken, roomId, provider, onRedirect]);

  if (!option) return null;

  const tags = [`+${formatTtl(option.ttlMs)}`, `${option.maxParticipants} members`, `${option.maxEvents} events`];

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
