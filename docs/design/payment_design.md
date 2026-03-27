# TempChat Payment Design

## 1. Overview

Room boosts are one-time purchases per room. Both payment methods — **SePay** (Vietnam, VND) and **Polar** (Global, USD) — are always presented to the user. Locale detection on the frontend determines which one is pre-selected by default:

| Signal | Default Selection |
|--------|------------------|
| `navigator.language` starts with `vi` | SePay |
| Timezone is `Asia/Ho_Chi_Minh` or `Asia/Saigon` | SePay |
| All other cases | Polar |

The user can switch to the other provider before confirming. The selected provider is sent to the backend in the initiate request.

---

## 2. Revised Boost Option Data Structure

### Backend (`backend/internal/boostoptions/options.go`)

Replace the current flat price fields with a nested `Pricing` struct:

```go
// Pricing holds the authoritative amounts for each supported currency.
// USDCents is used by Polar; VND is used by SePay.
// PolarPriceID is backend-only and never exposed in API responses.
type Pricing struct {
    USDCents     int    // e.g. 500 = $5.00
    VND          int64  // e.g. 120000 = 120.000 ₫
    PolarPriceID string // Polar product price ID, e.g. "price_01abc..."
}

type BoostOption struct {
    ID              string
    Name            string
    TTL             time.Duration
    MaxParticipants int
    MaxEvents       int
    Pricing         Pricing
}
```

`Pricing.PolarPriceID`, `Pricing.USDCents`, and `Pricing.VND` are loaded from environment variables at startup — not hardcoded:

```
POLAR_PRICE_ID_BOOST_PLUS=price_01abc...
POLAR_PRICE_ID_BOOST_PRO=price_01def...
BOOST_PLUS_USD_CENTS=500
BOOST_PLUS_VND=20000
BOOST_PRO_USD_CENTS=1000
BOOST_PRO_VND=50000
```

> **Note:** `BOOST_PLUS_USD_CENTS` and `BOOST_PRO_USD_CENTS` are used only for the display-only API response. The actual charge amount is set on the Polar product price in the Polar dashboard. These env var values must be kept in sync with the Polar-side price configuration.

### API Response (`GET /v1/boost-options`)

The response is display-only — numeric prices only, no payment provider IDs. Any price or name change is a backend-only update.

```json
[
  {
    "id": "boost_plus",
    "name": "Plus Boost",
    "ttlMs": 86400000,
    "maxParticipants": 10,
    "maxEvents": 100,
    "priceUsdCents": 500,
    "priceVnd": 20000
  },
  {
    "id": "boost_pro",
    "name": "Pro Boost",
    "ttlMs": 604800000,
    "maxParticipants": 50,
    "maxEvents": 200,
    "priceUsdCents": 1000,
    "priceVnd": 50000
  }
]
```

`Pricing.PolarPriceID` never appears in this response.

---

## 3. New API Endpoints

### 3.1 `POST /v1/payments/initiate`

Creates a pending order and returns provider-specific checkout info.

**Auth:** `X-TempChat-Auth` required. `uid` may be null for non-members (same pattern as the initial join request).

**Request:**
```json
{
  "roomId": "room-uuid",
  "boostId": "boost_plus",
  "provider": "sepay" | "polar"
}
```

**Validation:**
- Room must exist and not be expired
- Boost option must exist
- If `uid` is null (non-member): verify the boost raises `maxParticipants` above current `memberCount`

**Response — SePay:**
```json
{
  "provider": "sepay",
  "orderId": "tc_xxxxxxxxxxxxxxxx",
  "qrUrl": "https://qr.sepay.vn/img?acc={ACCOUNT}&bank={BANK_CODE}&amount=120000&des=tc_xxxxxxxxxxxxxxxx&template=compact",
  "amount": 120000,
  "currency": "VND",
  "expiresAt": 1715442800000
}
```

**Response — Polar:**
```json
{
  "provider": "polar",
  "orderId": "tc_xxxxxxxxxxxxxxxx",
  "checkoutUrl": "https://polar.sh/checkout/..."
}
```

For Polar, the backend calls `POST https://api.polar.sh/v1/checkouts` during this request to create a Polar checkout session. The session is created with `metadata: { orderId }` and `success_url` pointing back to the room page. If the Polar API is unavailable, the initiate endpoint returns `502`. Polar checkout sessions expire after ~24 hours, which aligns with the Redis order TTL.

**Rate limit:** 10 req/min, burst 5 — key prefix `rl:payment_initiate`.

---

### 3.2 `POST /v1/payments/sepay/webhook`

SePay calls this after a successful bank transfer.

**Auth:** Verify `Authorization: Apikey {token}` header against `SEPAY_WEBHOOK_API_KEY` env var.

**IP Whitelist:** Only accept requests from the following SePay IP addresses:

```
172.236.138.20
172.233.83.68
171.244.35.2
151.158.108.68
151.158.109.79
103.255.238.139
```

Return `403` for requests from any other IP.

**SePay payload (relevant fields):**
```json
{
  "id": 12345,
  "gateway": "Vietcombank",
  "transferAmount": 120000,
  "content": "tc_xxxxxxxxxxxxxxxx some other text",
  "referenceCode": "FT24300...",
  "transferType": "in"
}
```

**Processing:**
1. Verify API key header — return `401` if invalid
2. Extract `orderId` from `content` field (first token matching `tc_[a-z0-9]+`)
3. Idempotency: check `payment:sepay:ref:{referenceCode}` in Redis — return `200` immediately if exists
4. Load `order:{orderId}:meta`, verify `status == "pending"`
5. Verify `transferAmount` matches the order's `amountVND`
6. Apply boost via atomic Lua script (Lua script returns `room_not_found` if room is expired)
   - **Room alive:** broadcast `room:boosted` WS event, set order `status` to `"completed"`
   - **Room expired:** generate coupon (see [Coupon Design](features/coupon_design.md)), set order `status` to `"room_expired"`, store `couponCode` in order hash
7. Set `payment:sepay:ref:{referenceCode}` → `orderId` (TTL 7 days)
8. Return `200 OK`

---

### 3.3 `POST /v1/payments/polar/webhook`

Polar calls this for `order.paid` events (one-time purchases with `billing_reason: "purchase"`).

**Auth:** Verify `webhook-signature` header using HMAC-SHA256 with `POLAR_WEBHOOK_SECRET` env var (base64-encoded secret). Signed payload is `{webhook-timestamp}.{raw body}`.

**Relevant Polar event:**
```json
{
  "type": "order.paid",
  "data": {
    "id": "order_01abc...",
    "amount": 500,
    "currency": "usd",
    "billing_reason": "purchase",
    "metadata": {
      "orderId": "tc_xxxxxxxxxxxxxxxx"
    },
    "customer": { "...": "..." },
    "product": { "...": "..." }
  }
}
```

The `webhook-id` header value is used as the idempotency key.

**Processing:**
1. Verify `webhook-signature` — return `400` if invalid
2. Ignore events where `type != "order.paid"` or `billing_reason != "purchase"` — return `200 OK` immediately (prevents Polar retries on unrelated event types)
3. Idempotency: check `payment:polar:webhook:{webhook-id}` — return `200` immediately if exists
4. Extract `orderId` from `data.metadata.orderId`
5. Load `order:{orderId}:meta`, verify `status == "pending"`
6. Apply boost via atomic Lua script (Lua script returns `room_not_found` if room is expired)
   - **Room alive:** broadcast `room:boosted` WS event, set order `status` to `"completed"`
   - **Room expired:** generate coupon (see [Coupon Design](features/coupon_design.md)), set order `status` to `"room_expired"`, store `couponCode` in order hash
7. Set `payment:polar:webhook:{webhook-id}` → `"processed"` (TTL 7 days)
8. Return `200 OK`

---

## 4. Order Storage (Redis)

### Key: `order:{orderId}:meta` (Hash)

| Field | Type | Description |
|-------|------|-------------|
| `roomId` | string | Target room |
| `boostId` | string | e.g. `boost_plus` |
| `uid` | string | Booster's userId; empty string for non-members |
| `provider` | string | `sepay` or `polar` |
| `status` | string | `pending` / `completed` / `room_expired` |
| `couponCode` | string | Set only when `status == "room_expired"` |
| `amountVND` | int64 | For SePay orders |
| `createdAt` | int64 | Unix ms |

**TTL:** 24 hours. This covers both the SePay QR expiry window and the Polar checkout session expiry.

### Idempotency Keys

| Key | Value | TTL |
|-----|-------|-----|
| `payment:sepay:ref:{referenceCode}` | `orderId` | 7 days |
| `payment:polar:webhook:{webhookId}` | `"processed"` | 7 days |
| `coupon:{code}` | Hash (see [Coupon Design](features/coupon_design.md)) | 7 days |

---

## 5. SePay Payment Flow

```
Frontend                    Backend                     SePay
   |                            |                          |
   |-- POST /v1/payments/initiate ->                       |
   |   { roomId, boostId, provider: "sepay" }              |
   |                            | create order in Redis    |
   |<-- { orderId, qrUrl, amount, expiresAt }              |
   |                            |                          |
   | show SepayQRModal          |                          |
   | (QR image + countdown)     |                          |
   | poll GET /v1/orders/:orderId                          |
   |                            |                          |
   | [user pays via banking app]|------- bank transfer --->|
   |                            |                          |
   |                            |<-- POST /payments/sepay/webhook
   |                            | verify → apply boost     |
   |                            | (or generate coupon)     |
   |                            | broadcast room:boosted   |
   |                            |                          |
   |<-- order status: completed |                          |
   | (or room_expired + coupon) |                          |
   | close modal, show result   |                          |
```

**QR URL format:**
```
https://qr.sepay.vn/img?acc={SEPAY_ACCOUNT_NUMBER}&bank={SEPAY_BANK_CODE}&amount={amountVND}&des={orderId}&template=compact
```

The backend constructs this URL and returns it in the initiate response. The frontend renders it as an `<img>` src — no client-side QR generation library needed.

**Confirmation polling:** The frontend polls `GET /v1/orders/:orderId` every 3 seconds while the QR modal is open. This handles both the happy path (`completed`) and the expired-room fallback (`room_expired` with coupon). The WebSocket `room:boosted` event closes the modal in the happy path if the WS is connected.

---

## 6. Polar Checkout Flow

```
Frontend                    Backend                     Polar
   |                            |                          |
   |-- POST /v1/payments/initiate ->                       |
   |   { roomId, boostId, provider: "polar" }              |
   |                            | create order in Redis    |
   |                            |-- POST /v1/checkouts --->|
   |                            |<-- { checkoutUrl, ... }  |
   |<-- { orderId, checkoutUrl }                           |
   |                            |                          |
   | redirect to checkoutUrl    |                          |
   | (same tab)                 |                          |
   |                            |                          |
   | [user pays on Polar page]  |------- payment --------->|
   |                            |                          |
   | redirect to successUrl     |<-- POST /payments/polar/webhook
   | (back to room page)        | verify → apply boost     |
   | ?orderId={orderId}         | (or generate coupon)     |
   |                            | broadcast room:boosted   |
   | poll GET /v1/orders/:orderId                          |
   |<-- completed / room_expired|                          |
   | show result (or save coupon)                          |
```

**`successUrl` format:** `https://app.tempchat.io/chat/{roomId}?orderId={orderId}`

On load, `ChatPage` reads `orderId` from the query string and polls `GET /v1/orders/:orderId` every 3 seconds until `status != "pending"`. If `room_expired`, the coupon is saved to localStorage and a message is shown.

**Non-member redirect:** If the user was a non-member (initiated payment from `JoinPage`), Polar still redirects to `/chat/{roomId}?orderId=...`. `ChatPage` checks whether the user has joined this room (via localStorage identity). If not, it redirects to `/join/{roomId}?orderId={orderId}`, preserving the query param. `JoinPage` then reads `?orderId=` on load and begins polling `GET /v1/orders/:orderId`. Once the order is `completed`, `JoinPage` re-attempts the join request automatically.

**Backend — creating the Polar checkout session (Go):**
```go
import "github.com/polarsource/polar-go"

client := polar.NewClient(
    polar.WithAccessToken(os.Getenv("POLAR_ACCESS_TOKEN")),
    polar.WithEnvironment("production"),
)

session, err := client.Checkouts.Create(ctx, &polar.CheckoutCreateParams{
    ProductPriceID: boostOption.Pricing.PolarPriceID,
    SuccessURL:     successURL, // e.g. "https://app.tempchat.io/chat/{roomId}?orderId={orderId}"
    Metadata: map[string]string{
        "orderId": orderId,
    },
})
// Return session.URL as checkoutUrl
```

**Frontend — initiating Polar checkout:**
```typescript
// Redirect the current tab to the Polar hosted checkout page.
// Same-tab redirect avoids popup blockers on mobile.
window.location.href = checkoutUrl;
```

After completing payment, Polar redirects the user back to `successUrl`. `ChatPage` polls `GET /v1/orders/:orderId` to detect the outcome, forwarding to `JoinPage` if the user has not yet joined. The `room:boosted` WS event confirms success if the WebSocket is connected. No frontend Polar JS library is required.

---

## 7. Frontend Changes

### Provider Detection (`webapp/src/lib/payment.ts` — new file)

```typescript
export function detectPaymentProvider(): "sepay" | "polar" {
  const lang = (navigator.language || "").toLowerCase();
  if (lang.startsWith("vi")) return "sepay";
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Asia/Ho_Chi_Minh" || tz === "Asia/Saigon") return "sepay";
  } catch {}
  return "polar";
}
```

### `webapp/src/lib/api.ts`

Add `initiatePayment(params, authHeader)` returning `InitiatePaymentResponse` (union type of SePay and Polar responses). Add `getOrderStatus(orderId)` and `redeemCoupon(params, authHeader)`.

No changes to the `BoostOption` interface — provider IDs are not part of the boost options type.

### `webapp/src/components/chat/BoostSheet.tsx`

Replace `alert("Boost payment coming soon!")` with:
1. Detect provider via `detectPaymentProvider()`
2. Show "Your Coupons" section at top if `getUnusedCoupons()` is non-empty
3. Call `initiatePayment` when a paid option is selected
4. If SePay: mount `<SepayQRModal>`, poll `getOrderStatus` every 3s
5. If Polar: redirect to `checkoutUrl` via `window.location.href`
6. On `room_expired` order status: call `saveCoupon()`, show message, close modal

### `webapp/src/pages/JoinPage.tsx`

Replace the `BoostConstructionPage` redirect with the same payment flow as `BoostSheet`. On `room:boosted` WS event, re-attempt the `join` request. If user has a coupon that covers the needed tier, show "Apply coupon to join" alongside paid options.

On load, read `?orderId=` from query string — if present, poll `getOrderStatus` to detect a pending Polar confirmation (handles the case where the user returns from the Polar checkout but lands on a join page rather than a room page).

### New: `webapp/src/components/shared/SepayQRModal.tsx`

Bottom sheet / modal showing:
- QR code image (`<img src={qrUrl}>`)
- Amount in VND
- `orderId` as payment reference
- Countdown timer to order expiry
- "Waiting for confirmation..." spinner
- Dismiss button

Closes automatically on `room:boosted` WS event or when `getOrderStatus` returns `completed` / `room_expired`.

---

## 8. Files to Create / Modify

| File | Action |
|------|--------|
| `docs/design/payment_design.md` | New — this document |
| `docs/design/features/coupon_design.md` | New — coupon fallback design |
| `backend/internal/boostoptions/options.go` | Add `PolarPriceID`, `AmountVND` to struct; load from env at startup |
| `backend/internal/handler/boost.go` | Updated to read from `Pricing` struct; exposes `priceUsdCents` and `priceVnd` only |
| `backend/internal/handler/payment.go` | New — `InitiatePayment`, `SepayWebhook`, `PolarWebhook`, `GetOrderStatus`, `RedeemCoupon` handlers |
| `backend/internal/store/store.go` | Add `CreateOrder`, `GetOrder`, `CompleteOrder`, `CreateCoupon`, `GetCoupon`, `RedeemCoupon`, `GetOrderStatus`, idempotency key methods |
| `backend/cmd/server/main.go` | Register `/v1/payments/*`, `GET /v1/orders/:orderId`, and `POST /v1/rooms/:roomId/redeem-coupon` routes with rate limits |
| `webapp/src/lib/payment.ts` | New — provider detection, `initiatePayment`, `saveCoupon`, `getUnusedCoupons`, `removeCoupon` |
| `webapp/src/lib/api.ts` | Add payment types, `initiatePayment`, `getOrderStatus`, `redeemCoupon`; no change to `BoostOption` interface |
| `webapp/src/components/chat/BoostSheet.tsx` | Replace stub with real payment flow; add "Your Coupons" section |
| `webapp/src/components/shared/SepayQRModal.tsx` | New — QR display modal component |
| `webapp/src/pages/JoinPage.tsx` | Replace `BoostConstructionPage` with real payment flow; add coupon redemption option |

---

## 9. Environment Variables

| Variable | Side | Description |
|----------|------|-------------|
| `POLAR_ACCESS_TOKEN` | Backend | Organization Access Token for Polar API (creates checkout sessions) |
| `POLAR_WEBHOOK_SECRET` | Backend | Webhook signature verification key (base64-encoded) |
| `POLAR_PRICE_ID_BOOST_PLUS` | Backend | Polar product price ID for Plus Boost |
| `POLAR_PRICE_ID_BOOST_PRO` | Backend | Polar product price ID for Pro Boost |
| `SEPAY_WEBHOOK_API_KEY` | Backend | Verify incoming SePay webhook requests |
| `SEPAY_ACCOUNT_NUMBER` | Backend | Bank account number for QR generation |
| `SEPAY_BANK_CODE` | Backend | Bank code for QR generation (e.g. `VCB`) |
| `BOOST_PLUS_VND` | Backend | VND price for Plus Boost |
| `BOOST_PRO_VND` | Backend | VND price for Pro Boost |

> No frontend environment variables are required for Polar. The checkout is server-initiated; the frontend only receives a URL to redirect to.

---

## 10. Verification

1. **Unit tests** (`backend/internal/handler/payment_test.go`): idempotency on duplicate webhook, invalid signature rejection, non-member boost validation, expired order rejection, Polar API error returns 502, expired-room webhook generates coupon, duplicate expired-room webhook does not generate second coupon, `RedeemCoupon` with used coupon returns 409, `RedeemCoupon` with expired coupon returns 404
2. **Integration test**: full SePay and Polar flows against test server (`:8081`) using sandbox credentials
3. **Manual**: open boost sheet in browser — both SePay and Polar options are visible; Vietnamese locale has SePay pre-selected, others have Polar pre-selected
4. **WS confirmation**: `room:boosted` event arrives and UI updates room lifetime and participant cap
5. **Coupon flow**: expire a room manually in Redis, complete payment, verify coupon appears in `localStorage.tc_coupons`, open BoostSheet on a new room, apply coupon, verify `room:boosted` fires and coupon is removed from localStorage
