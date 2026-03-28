/** Returns the SePay PG hosted checkout URL based on VITE_SEPAY_PG_ENV. */
export function sepayCheckoutUrl(): string {
  return import.meta.env.VITE_SEPAY_PG_ENV === "sandbox"
    ? "https://pay-sandbox.sepay.vn/v1/checkout/init"
    : "https://pay.sepay.vn/v1/checkout/init";
}

/** Builds signed SePay PG form fields using the Web Crypto API (HMAC-SHA256, base64). */
export async function buildSePayFormFields(params: {
  orderId: string;
  amountVnd: number;
  roomId: string;
}): Promise<Record<string, string>> {
  const merchantId = import.meta.env.VITE_SEPAY_PG_MERCHANT_ID as string;
  const secretKey = import.meta.env.VITE_SEPAY_PG_SECRET_KEY as string;
  const returnUrl = `${window.location.origin}/chat/${params.roomId}?orderId=${params.orderId}`;

  const fields: Record<string, string> = {
    merchant: merchantId,
    operation: "PURCHASE",
    payment_method: "BANK_TRANSFER",
    order_invoice_number: params.orderId,
    order_amount: String(params.amountVnd),
    currency: "VND",
    order_description: "TempChat Room Boost",
    success_url: returnUrl,
    error_url: returnUrl,
    cancel_url: returnUrl,
  };

  // Canonical field order per SePay NodeJS SDK docs — must not be reordered
  const order = [
    "merchant", "operation", "payment_method", "order_invoice_number",
    "order_amount", "currency", "order_description", "customer_id",
    "success_url", "error_url", "cancel_url", "custom_data",
  ];
  const signed = order
    .filter((k) => fields[k])
    .map((k) => `${k}=${fields[k]}`)
    .join(",");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
  fields.signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return fields;
}

/** Detect the preferred payment provider based on locale and timezone. */
export function detectPaymentProvider(): "sepay" | "polar" {
  const lang = (navigator.language || "").toLowerCase();
  if (lang.startsWith("vi")) return "sepay";
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Asia/Ho_Chi_Minh" || tz === "Asia/Saigon") return "sepay";
  } catch {}
  return "polar";
}

const STORAGE_KEY = "tc_coupons";

export interface StoredCoupon {
  code: string;
  boostName: string;
  ttlMs: number;
  maxParticipants: number;
  maxEvents: number;
  expiresAt: number; // unix ms
}

function readAll(): StoredCoupon[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as StoredCoupon[];
  } catch {
    return [];
  }
}

function writeAll(coupons: StoredCoupon[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(coupons));
}

/** Append a coupon, deduplicating by code and pruning expired entries. */
export function saveCoupon(coupon: StoredCoupon): void {
  const now = Date.now();
  const existing = readAll().filter((c) => c.code !== coupon.code && c.expiresAt >= now);
  writeAll([...existing, coupon]);
}

/** Return all coupons that have not yet expired. */
export function getUnusedCoupons(): StoredCoupon[] {
  const now = Date.now();
  return readAll().filter((c) => c.expiresAt >= now);
}

/** Remove the coupon with the given code. */
export function removeCoupon(code: string): void {
  writeAll(readAll().filter((c) => c.code !== code));
}
