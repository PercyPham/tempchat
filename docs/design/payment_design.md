# TempChat Payment Design

## 1. Overview

Room boosts are one-time purchases per room. Both payment methods — **SePay** (Vietnam, VND) and **Paddle** (Global, USD) — are always presented to the user. Locale detection on the frontend determines which one is pre-selected by default:

| Signal | Default Selection |
|--------|------------------|
| `navigator.language` starts with `vi` | SePay |
| Timezone is `Asia/Ho_Chi_Minh` or `Asia/Saigon` | SePay |
| All other cases | Paddle |

The user can switch to the other provider before confirming. The selected provider is sent to the backend in the initiate request.

---

## 2. Revised Boost Option Data Structure

### Backend (`backend/internal/boostoptions/options.go`)

Replace the current flat price fields with a nested `Pricing` struct:

```go
// Pricing holds the authoritative amounts for each supported currency.
// USDCents is used by Paddle; VND is used by SePay.
// PaddlePriceID is backend-only and never exposed in API responses.
type Pricing struct {
    USDCents      int    // e.g. 500 = $5.00
    VND           int64  // e.g. 120000 = 120.000 ₫
    PaddlePriceID string // Paddle price ID, e.g. "pri_01abc..."
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

`Pricing.PaddlePriceID`, `Pricing.USDCents`, and `Pricing.VND` are loaded from environment variables at startup — not hardcoded:

```
PADDLE_PRICE_ID_BOOST_PLUS=pri_01abc...
PADDLE_PRICE_ID_BOOST_PRO=pri_01def...
BOOST_PLUS_USD_CENTS=500
BOOST_PLUS_VND=20000
BOOST_PRO_USD_CENTS=1000
BOOST_PRO_VND=50000
```

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

`Pricing.PaddlePriceID` never appears in this response. The frontend formats display strings from the numeric values (`500` → `$5.00`, `120000` → `120.000 ₫`). The frontend only ever learns the `paddlePriceId` from the `POST /v1/payments/initiate` response, scoped to a single checkout session.

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
  "provider": "sepay" | "paddle"
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

**Response — Paddle:**
```json
{
  "provider": "paddle",
  "orderId": "tc_xxxxxxxxxxxxxxxx",
  "paddlePriceId": "pri_01abc..."
}
```

**Rate limit:** 10 req/min, burst 5 — key prefix `rl:payment_initiate`.

---

### 3.2 `POST /v1/payments/sepay/webhook`

SePay calls this after a successful bank transfer.

**Auth:** Verify `Authorization: Apikey {token}` header against `SEPAY_WEBHOOK_API_KEY` env var.

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
4. Load `order:{orderId}:meta`, verify `status == "pending"` and room is not expired
5. Verify `transferAmount` matches the order's `amountVND`
6. Apply boost via atomic Lua script, broadcast `room:boosted` WS event
7. Set order `status` to `"completed"`
8. Set `payment:sepay:ref:{referenceCode}` → `orderId` (TTL 30 days)
9. Return `200 OK`

---

### 3.3 `POST /v1/payments/paddle/webhook`

Paddle calls this for `transaction.completed` events.

**Auth:** Verify `Paddle-Signature` header (ts + h1 HMAC-SHA256) using `PADDLE_WEBHOOK_SECRET` env var.

**Relevant Paddle event:**
```json
{
  "event_id": "evt_01abc...",
  "event_type": "transaction.completed",
  "data": {
    "id": "txn_01abc...",
    "status": "completed",
    "custom_data": {
      "orderId": "tc_xxxxxxxxxxxxxxxx"
    }
  }
}
```

**Processing:**
1. Verify `Paddle-Signature` — return `401` if invalid
2. Ignore events where `event_type != "transaction.completed"`
3. Idempotency: check `payment:paddle:event:{event_id}` — return `200` immediately if exists
4. Extract `orderId` from `data.custom_data.orderId`
5. Load `order:{orderId}:meta`, verify `status == "pending"`
6. Apply boost via atomic Lua script, broadcast `room:boosted` WS event
7. Set order `status` to `"completed"`
8. Set `payment:paddle:event:{event_id}` → `"processed"` (TTL 30 days)
9. Return `200 OK`

---

## 4. Order Storage (Redis)

### Key: `order:{orderId}:meta` (Hash)

| Field | Type | Description |
|-------|------|-------------|
| `roomId` | string | Target room |
| `boostId` | string | e.g. `boost_plus` |
| `uid` | string | Booster's userId; empty string for non-members |
| `provider` | string | `sepay` or `paddle` |
| `status` | string | `pending` / `completed` |
| `amountVND` | int64 | For SePay orders |
| `createdAt` | int64 | Unix ms |

**TTL:** 24 hours. This covers the SePay QR expiry window.

### Idempotency Keys

| Key | Value | TTL |
|-----|-------|-----|
| `payment:sepay:ref:{referenceCode}` | `orderId` | 30 days |
| `payment:paddle:event:{eventId}` | `"processed"` | 30 days |

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
   |                            |                          |
   | [user pays via banking app]|------- bank transfer --->|
   |                            |                          |
   |                            |<-- POST /payments/sepay/webhook
   |                            | verify → apply boost     |
   |                            | broadcast room:boosted   |
   |                            |                          |
   |<-------- WS room:boosted --|                          |
   | close modal, show success  |                          |
```

**QR URL format:**
```
https://qr.sepay.vn/img?acc={SEPAY_ACCOUNT_NUMBER}&bank={SEPAY_BANK_CODE}&amount={amountVND}&des={orderId}&template=compact
```

The backend constructs this URL and returns it in the initiate response. The frontend renders it as an `<img>` src — no client-side QR generation library needed.

**Fallback polling:** If the WebSocket is disconnected, the frontend polls `GET /v1/rooms/:roomId` every 3 seconds. A change in `expiresAt` or `maxParticipants` confirms the boost was applied.

---

## 6. Paddle Checkout Flow

```
Frontend                    Backend                     Paddle
   |                            |                          |
   |-- POST /v1/payments/initiate ->                       |
   |   { roomId, boostId, provider: "paddle" }             |
   |                            | create order in Redis    |
   |<-- { orderId, paddlePriceId }                         |
   |                            |                          |
   | Paddle.js overlay open     |                          |
   | items: [{ priceId }]       |                          |
   | customData: { orderId }    |------- checkout -------->|
   |                            |                          |
   |<------ checkout.completed (Paddle.js event) ---------|
   | (close overlay)            |                          |
   |                            |<-- POST /payments/paddle/webhook
   |                            | verify → apply boost     |
   |                            | broadcast room:boosted   |
   |<-------- WS room:boosted --|                          |
   | show success UI            |                          |
```

**Paddle.js initialization (frontend):**
```typescript
Paddle.Initialize({
  token: import.meta.env.VITE_PADDLE_CLIENT_TOKEN,
  environment: import.meta.env.VITE_PADDLE_ENV, // "production" | "sandbox"
});
```

**Opening checkout:**
```typescript
Paddle.Checkout.open({
  items: [{ priceId: paddlePriceId, quantity: 1 }],
  customData: { orderId },
  settings: { successUrl: window.location.href },
});
```

The `checkout.completed` Paddle.js event closes the overlay on the frontend. The `room:boosted` WS event confirms the boost was actually applied server-side.

---

## 7. Frontend Changes

### Provider Detection (`webapp/src/lib/payment.ts` — new file)

```typescript
export function detectPaymentProvider(): "sepay" | "paddle" {
  const lang = (navigator.language || "").toLowerCase();
  if (lang.startsWith("vi")) return "sepay";
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Asia/Ho_Chi_Minh" || tz === "Asia/Saigon") return "sepay";
  } catch {}
  return "paddle";
}
```

### `webapp/src/lib/api.ts`

Add `initiatePayment(params, authHeader)` returning `InitiatePaymentResponse` (union type of SePay and Paddle responses).

No changes to the `BoostOption` interface — provider IDs are not part of the boost options type.

### `webapp/src/components/chat/BoostSheet.tsx`

Replace `alert("Boost payment coming soon!")` with:
1. Detect provider via `detectPaymentProvider()`
2. Call `initiatePayment`
3. If SePay: mount `<SepayQRModal>`, wait for `room:boosted` WS event to close
4. If Paddle: call `Paddle.Checkout.open(...)` with `paddlePriceId` + `{ orderId }` custom data; wait for `room:boosted` WS event to show confirmation

### `webapp/src/pages/JoinPage.tsx`

Replace the `BoostConstructionPage` redirect with the same payment flow as `BoostSheet`. On `room:boosted` WS event, re-attempt the `join` request.

### New: `webapp/src/components/shared/SepayQRModal.tsx`

Bottom sheet / modal showing:
- QR code image (`<img src={qrUrl}>`)
- Amount in VND
- `orderId` as payment reference
- Countdown timer to order expiry
- "Waiting for confirmation..." spinner
- Dismiss button

Closes automatically on `room:boosted` WS event.

---

## 8. Files to Create / Modify

| File | Action |
|------|--------|
| `docs/design/payment_design.md` | New — this document |
| `backend/internal/boostoptions/options.go` | Add `PaddlePriceID`, `AmountVND` to struct; load from env at startup |
| `backend/internal/handler/boost.go` | Updated to read from `Pricing` struct; exposes `priceUsdCents` and `priceVnd` only |
| `backend/internal/handler/payment.go` | New — `InitiatePayment`, `SepayWebhook`, `PaddleWebhook` handlers |
| `backend/internal/store/store.go` | Add `CreateOrder`, `GetOrder`, `CompleteOrder`, idempotency key methods |
| `backend/cmd/server/main.go` | Register `/v1/payments/*` routes with rate limits |
| `webapp/src/lib/payment.ts` | New — provider detection + `initiatePayment` call |
| `webapp/src/lib/api.ts` | Add payment types and `initiatePayment` function; no change to `BoostOption` interface |
| `webapp/src/components/chat/BoostSheet.tsx` | Replace stub with real payment flow |
| `webapp/src/components/shared/SepayQRModal.tsx` | New — QR display modal component |
| `webapp/src/pages/JoinPage.tsx` | Replace `BoostConstructionPage` with real payment flow |

---

## 9. Environment Variables

| Variable | Side | Description |
|----------|------|-------------|
| `PADDLE_WEBHOOK_SECRET` | Backend | Webhook HMAC-SHA256 verification key |
| `PADDLE_PRICE_ID_BOOST_PLUS` | Backend | Paddle price ID for Plus Boost |
| `PADDLE_PRICE_ID_BOOST_PRO` | Backend | Paddle price ID for Pro Boost |
| `SEPAY_WEBHOOK_API_KEY` | Backend | Verify incoming SePay webhook requests |
| `SEPAY_ACCOUNT_NUMBER` | Backend | Bank account number for QR generation |
| `SEPAY_BANK_CODE` | Backend | Bank code for QR generation (e.g. `VCB`) |
| `SEPAY_AMOUNT_VND_BOOST_PLUS` | Backend | VND price for Plus Boost |
| `SEPAY_AMOUNT_VND_BOOST_PRO` | Backend | VND price for Pro Boost |
| `VITE_PADDLE_CLIENT_TOKEN` | Frontend | Paddle.js client-side token |
| `VITE_PADDLE_ENV` | Frontend | `"production"` or `"sandbox"` |

---

## 10. Verification

1. **Unit tests** (`backend/internal/handler/payment_test.go`): idempotency on duplicate webhook, invalid signature rejection, non-member boost validation, expired order rejection
2. **Integration test**: full SePay and Paddle flows against test server (`:8081`) using sandbox credentials
3. **Manual**: open boost sheet in browser — both SePay and Paddle options are visible; Vietnamese locale has SePay pre-selected, others have Paddle pre-selected
4. **WS confirmation**: `room:boosted` event arrives and UI updates room lifetime and participant cap
