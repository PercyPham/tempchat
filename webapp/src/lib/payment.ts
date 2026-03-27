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
