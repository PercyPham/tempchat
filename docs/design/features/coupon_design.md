# TempChat Coupon Design

## 1. Overview

Coupons are issued as a fallback when a payment is confirmed by a provider (SePay or Polar) but the target room has already expired and been deleted from Redis. Because the room's crypto data (`public_key`, encrypted name) is permanently gone, the boost cannot be applied retroactively. Instead, a coupon is generated that the user can apply to any room at a later time.

Coupons are stored in Redis with a 7-day TTL and in the user's browser `localStorage`. They can be redeemed on any room the user has access to.

---

## 2. Coupon Storage (Redis)

### Key: `coupon:{code}` (Hash)

| Field | Type | Description |
|-------|------|-------------|
| `boostId` | string | Original boost ID — for audit/display only |
| `boostName` | string | Display name snapshot, e.g. `Plus Boost` |
| `ttlMs` | int64 | Boost duration snapshot in ms — used when applying |
| `maxParticipants` | int | Participant cap snapshot — used when applying |
| `maxEvents` | int | Event cap snapshot — used when applying |
| `originalOrderId` | string | The `tc_xxxxxxxxxxxxxxxx` order that generated this coupon |
| `status` | string | `unused` \| `used` |
| `createdAt` | int64 | Unix ms |
| `usedAt` | int64 | Unix ms — absent if unused |
| `usedForRoomId` | string | Absent if unused |

All boost values (`ttlMs`, `maxParticipants`, `maxEvents`) are **snapshotted at coupon generation time** from the boost option that was purchased. This ensures redemption uses the original purchased values even if boost options are later modified or removed.

**TTL:** 7 days.

**Code format:** `tc_cpn_` followed by 16 cryptographically random hex characters (Go `crypto/rand`). Example: `tc_cpn_a1b2c3d4e5f6g7h8`.

---

## 3. Coupon Generation

Coupons are generated inside the SePay and Polar webhook handlers when the room is found to be expired (Lua boost script returns `room_not_found`):

1. Generate coupon code via `crypto/rand`
2. Snapshot boost values from the boost option: `ttlMs`, `maxParticipants`, `maxEvents`, `boostName`
3. Write `coupon:{code}` hash to Redis with 7-day TTL (including all snapshot fields)
4. Write `couponCode` field into `order:{orderId}:meta`
5. Set order `status` to `room_expired`

The webhook still returns `200 OK` to prevent provider retries.

---

## 4. New API Endpoints

### 4.1 `GET /v1/orders/:orderId`

Frontend polls this endpoint while waiting for payment confirmation (both SePay and Polar flows). Replaces reliance on the room-polling fallback, which breaks when the room is expired.

**Auth:** None — the `orderId` is a 16-hex random secret; possession is proof of intent.

**Response:**

```json
// Awaiting payment
{ "status": "pending" }

// Boost applied successfully
{ "status": "completed" }

// Room expired before boost could be applied — coupon issued
{
  "status": "room_expired",
  "coupon": {
    "code": "tc_cpn_a1b2c3d4e5f6g7h8",
    "boostName": "Plus Boost",
    "ttlMs": 86400000,
    "maxParticipants": 10,
    "maxEvents": 100,
    "expiresAt": 1716000000000
  }
}
```

Returns `404` if the order does not exist (24h TTL elapsed or invalid ID).

**Rate limit:** 20 req/min, burst 5 — key prefix `rl:order_status`.

---

### 4.2 `POST /v1/rooms/:roomId/redeem-coupon`

Applies a coupon to an existing room. The coupon is looked up directly by its code — no dependency on the original order that generated it. The coupon code is passed in the request body (not the URL) to keep it out of server logs and browser history.

**Auth:** `X-TempChat-Auth` required. `uid` may be null for non-members (same pattern as `POST /v1/payments/initiate`).

**Request:**
```json
{
  "couponCode": "tc_cpn_a1b2c3d4e5f6g7h8"
}
```

**Processing:**
1. Load `coupon:{couponCode}` — return `404` if not found or TTL-expired
2. Verify `coupon.status == "unused"` — return `409 coupon_already_used` if not
3. Verify room exists and is not expired — return `404 room_not_found`
4. If `uid` is null: verify `coupon.maxParticipants` > current `memberCount`
5. Apply boost via the existing atomic Lua script using **snapshot values** (`coupon.ttlMs`, `coupon.maxParticipants`, `coupon.maxEvents`) — do **not** re-fetch the boost option
6. Broadcast `room:boosted` WS event
7. Mark coupon: `status = used`, `usedAt = now`, `usedForRoomId = roomId`
8. Return `200 OK`

**Rate limit:** 10 req/min, burst 3 — key prefix `rl:coupon_redeem`.

---

## 5. Frontend Changes

### 5.1 Coupon localStorage Schema

**Key:** `tc_coupons`
**Value:** JSON array of `StoredCoupon`

```typescript
interface StoredCoupon {
  code: string;             // tc_cpn_... — used to call POST /coupons/:code/redeem
  boostName: string;        // for display
  ttlMs: number;            // snapshot — for display ("extends room by X")
  maxParticipants: number;  // snapshot — for eligibility check before calling API
  maxEvents: number;        // snapshot
  expiresAt: number;        // coupon expiry (7 days from generation), unix ms
}
```

Helper functions in `webapp/src/lib/payment.ts`:

```typescript
export function saveCoupon(coupon: StoredCoupon): void
// Appends to array, deduplicates by code, prunes entries where expiresAt < Date.now()

export function getUnusedCoupons(): StoredCoupon[]
// Returns coupons filtered to expiresAt >= Date.now()

export function removeCoupon(code: string): void
// Removes entry with matching code from the array
```

### 5.2 Polling During Payment Wait

Both the SePay QR modal and the Polar redirect-return page should poll `GET /v1/orders/:orderId` every 3 seconds while waiting for confirmation:

- `status == "completed"` → existing `room:boosted` WS success flow
- `status == "room_expired"` → call `saveCoupon()` with the coupon data from the response → close modal → show message (see §5.3)
- `status == "pending"` → continue polling

This replaces the existing fallback of polling `GET /v1/rooms/:roomId` (which returns 404 when the room is expired).

### 5.3 User-Facing Message

When `room_expired` is detected, display a bottom sheet or toast:

> "Your room expired before the boost could be applied. A **[Boost Name]** coupon has been saved — use it on your next room. It expires in 7 days."

### 5.4 `webapp/src/components/chat/BoostSheet.tsx`

Add a "Your Coupons" section at the top of the sheet, rendered only when `getUnusedCoupons()` returns a non-empty array. Each entry shows:

- Boost name
- Extends room by (derived from `ttlMs`)
- Participant cap (from `maxParticipants`)
- Expiry date
- "Apply to this room" button — calls `POST /v1/rooms/:roomId/redeem-coupon` with `{ couponCode: coupon.code }`, then calls `removeCoupon(coupon.code)` on success

### 5.5 `webapp/src/pages/JoinPage.tsx`

When a join is rejected due to `room_full` and the user has a coupon whose `maxParticipants` would exceed the current `memberCount` (checked client-side against the snapshot), show the coupon as a redemption option alongside the paid boost options.

---

## 6. Files to Create / Modify

| File | Action |
|------|--------|
| `docs/design/features/coupon_design.md` | New — this document |
| `backend/internal/store/store.go` | Add `CreateCoupon`, `GetCoupon`, `MarkCouponUsed`, `GetOrderStatus` to Store interface |
| `backend/internal/handler/payment.go` | Add coupon generation in both webhook handlers; add `GetOrderStatus` handler; add `RedeemCoupon` handler |
| `backend/cmd/server/main.go` | Register `GET /v1/orders/:orderId` and `POST /v1/rooms/:roomId/redeem-coupon` routes |
| `webapp/src/lib/payment.ts` | Add `saveCoupon`, `getUnusedCoupons`, `removeCoupon` helpers |
| `webapp/src/lib/api.ts` | Add `getOrderStatus`, `redeemCoupon` functions; add `StoredCoupon`, `OrderStatusResponse` types |
| `webapp/src/components/chat/BoostSheet.tsx` | Add "Your Coupons" section |
| `webapp/src/pages/JoinPage.tsx` | Show coupon option when room is full |

---

## 7. Verification

1. **Unit tests** (add to `backend/internal/handler/payment_test.go`):
   - Webhook with expired room → coupon generated with correct snapshot values, order status `room_expired`
   - Duplicate webhook with expired room → idempotency key prevents second coupon from being generated
   - `RedeemCoupon` with already-used coupon → `409`
   - `RedeemCoupon` with TTL-expired coupon → `404`
   - `RedeemCoupon` targeting an expired room → `404`
   - `GetOrderStatus` after 24h order TTL → `404`
   - Boost option modified after coupon generation → redemption still uses snapshot values

2. **Manual flow**:
   - Expire a room manually (reduce TTL to near zero in Redis)
   - Complete SePay or Polar payment
   - Verify `localStorage.tc_coupons` contains the coupon with correct `ttlMs`, `maxParticipants`, `expiresAt`
   - Open BoostSheet on a new room → "Your Coupons" section visible with correct display values
   - Click "Apply to this room" → verify `room:boosted` WS event fires and coupon disappears from localStorage
