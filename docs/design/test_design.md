# TempChat Test Design

## Overview

TempChat's security model rests on two client-side crypto primitives and server-side validation:

1. **Key derivation:** `PBKDF2-HMAC-SHA-512(secret, "rak", 600k+)` → `roomAccessKey` (AES-256 CryptoKey)
2. **Message encryption:** `AES-GCM(plaintext, secret)`
3. **Request signing:** `X-TempChat-Auth: Base64(claimsJSON).HMAC-SHA-256-Hex(Base64(claimsJSON), roomAccessKey)`
4. **Server validation:** HMAC check + timestamp drift ±5s

This document defines three test layers:

| Layer                    | Location                                   | Requires backend?     |
| ------------------------ | ------------------------------------------ | --------------------- |
| Webapp crypto unit tests | `webapp/src/lib/crypto.test.ts`            | No                    |
| Webapp integration tests | `webapp/src/lib/integration.test.ts`       | Yes (Redis + backend) |
| Backend Go unit tests    | `backend/internal/middleware/auth_test.go` | No (no Redis)         |

---

## Layer 1: Webapp Crypto Unit Tests

**File:** `webapp/src/lib/crypto.test.ts`
**Runner:** Vitest (Node environment, Web Crypto API available in Node 18+)
**Dependencies:** imports from `webapp/src/lib/crypto.ts` only — no network

### 1.1 PBKDF2 Key Derivation

```
deriveRoomAccessKey(secret: string): Promise<CryptoKey>
```

| Test                             | Assertion                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Deterministic output             | `deriveRoomAccessKey(s)` called twice with the same `secret` → both keys encrypt/decrypt the same plaintext successfully |
| Key algorithm                    | Exported key algorithm is `AES-GCM`, length 256                                                                          |
| Different secret → different key | `encrypt(pt, keyA)` cannot be decrypted with `keyB` (wrong key throws)                                                   |

### 1.2 AES-GCM Encryption / Decryption

```
encrypt(plaintext: string, key: CryptoKey): Promise<string>   // returns base64 ciphertext
decrypt(ciphertext: string, key: CryptoKey): Promise<string>
```

| Test                    | Assertion                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Round-trip              | `decrypt(encrypt(pt, key), key) === pt` for arbitrary UTF-8 input                       |
| IV uniqueness           | Two `encrypt(pt, key)` calls on the same plaintext produce different ciphertext strings |
| Wrong key throws        | `decrypt(ciphertext, wrongKey)` rejects (OperationError or DOMException)                |
| Empty string round-trip | `encrypt("", key)` → `decrypt(..., key) === ""`                                         |

### 1.3 HMAC-SHA-256 Auth Token

```
buildAuthToken(rid: string, uid: string | null, key: CryptoKey): Promise<string>
```

Token format: `Base64(claimsJSON).HexHMAC`
Claims: `{ "rid": rid, "uid": uid, "ts": <unix_seconds> }`

| Test                             | Assertion                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| Format                           | Token matches `/^[A-Za-z0-9+/=]+\.[0-9a-f]{64}$/`                                     |
| Claims content                   | Base64-decoded first segment parses to JSON with keys `rid`, `uid`, `ts`              |
| `uid: null` accepted             | `buildAuthToken(rid, null, key)` resolves without error; claims contain `"uid": null` |
| Different `ts` → different token | Two tokens built 1s apart (mock `Date.now`) differ                                    |
| Deterministic                    | Same `rid`, `uid`, and frozen `ts` → same token (mock `Date.now` to fixed value)      |

---

## Layer 2: Webapp Integration Tests

**File:** `webapp/src/lib/integration.test.ts`
**Runner:** Vitest (Node environment)
**Dependencies:** imports from `webapp/src/lib/crypto.ts` and `webapp/src/lib/api.ts`

### Prerequisites

```bash
make dev-up                          # start Redis on :6379
go run ./backend/cmd/server &        # start backend on :8080
```

Tests read `BACKEND_URL` from `.env.test` (default `http://localhost:8080`). Each test suite begins with a reachability check:

```ts
const reachable = await fetch(`${BACKEND_URL}/health`)
  .then((r) => r.ok)
  .catch(() => false);
if (!reachable) return; // skip entire suite
```

### 2.1 Flow 1 — Room Lifecycle

1. Call `POST /v1/rooms` with `{ name, accessKey: base64(key) }` → expect `201`, receive `{ roomId, createdAt, expiresAt }`
2. Call `POST /v1/rooms/:roomId/join` with signed token (`uid: null`), body `{ displayName: "Alice" }` → expect `200`, receive `{ userId, joinEid, room }`
3. Assert `room.memberCount === 1`, `room.name === roomName`, `room.expiresAt` is a positive integer
4. Call `GET /v1/rooms/:roomId` with signed token (`uid: userId`) → expect `200`
5. Assert response `memberCount === 1`, `members[0].uid === userId`

### 2.2 Flow 2 — Message Encryption Round-Trip

1. Create room; derive `roomAccessKey` from a random secret
2. Join as User A → `userIdA`
3. Join as User B → `userIdB`
4. Connect User B's WebSocket to `/v1/rooms/:roomId/ws` (with auth header); collect `message:receive` events
5. User A connects WebSocket and sends `{ event: "message:send", m: encrypt(plaintext, key) }`
6. Assert User B's WebSocket receives `message:receive` event with non-empty `msg` field
7. Assert `decrypt(msg, key) === plaintext`

### 2.3 Flow 3 — Auth Rejection Cases

All requests target a previously created room. Each case expects `401`:

| Case                   | How to trigger                                                    |
| ---------------------- | ----------------------------------------------------------------- |
| Expired timestamp      | Build token with `ts = now - 10` (10s ago)                        |
| Future timestamp       | Build token with `ts = now + 10` (10s ahead)                      |
| Tampered signature     | Build valid token, replace last 4 hex chars of HMAC with `"0000"` |
| Wrong roomId in claims | Build valid token but set `rid` to a different UUID               |
| Missing auth header    | Send request with no `X-TempChat-Auth` header                     |

### 2.4 Flow 4 — Late-Join Event Filtering

1. Create room; User A joins (`joinEidA`)
2. User A sends 3 messages → eids N+1, N+2, N+3
3. User B joins → `joinEidB = N+3`
4. `GET /v1/rooms/:roomId/events?afterEid=${joinEidB}` as User B → expect `[]`
5. User A sends 2 more messages → eids N+4, N+5
6. `GET /v1/rooms/:roomId/events?afterEid=${joinEidB}` as User B → expect array with `eid` values `N+4` and `N+5` only, in order

### 2.5 Flow 5 — Capacity Enforcement

1. Create a Free room (max 5 participants)
2. Join 5 users (each with unique `displayName`) → all succeed with `200`
3. Attempt a 6th join → expect `403` with body `{ "error": "room_full" }`

---

## Layer 3: Backend Go Unit Tests — Auth Middleware

**File:** `backend/internal/middleware/auth_test.go`
**Runner:** `go test ./internal/middleware/...`
**Dependencies:** none (no Redis, no real HTTP server)

Tests construct a minimal Gin context with a crafted `X-TempChat-Auth` header, call the middleware handler directly, and inspect the HTTP response code.

Helper: `buildToken(rid, uid string, tsOffset int, key []byte) string` — builds a valid token offset by `tsOffset` seconds from now, then allows the test to optionally corrupt the HMAC.

| Test                 | Setup                                       | Expected                               |
| -------------------- | ------------------------------------------- | -------------------------------------- |
| Valid token          | `ts = now`, correct HMAC                    | middleware calls `c.Next()` (no abort) |
| Expired token        | `ts = now - 6`                              | `401 Unauthorized`                     |
| Future token         | `ts = now + 6`                              | `401 Unauthorized`                     |
| Boundary — 5s old    | `ts = now - 5`                              | passes (within tolerance)              |
| Boundary — 5s future | `ts = now + 5`                              | passes (within tolerance)              |
| Tampered claims      | flip one byte in claims segment             | `401 Unauthorized`                     |
| Tampered HMAC        | replace last 4 hex chars with `"0000"`      | `401 Unauthorized`                     |
| Missing header       | no `X-TempChat-Auth`                        | `401 Unauthorized`                     |
| Malformed Base64     | `X-TempChat-Auth: !!!.abc`                  | `401 Unauthorized`                     |
| Malformed structure  | `X-TempChat-Auth: nodot` (no `.` separator) | `401 Unauthorized`                     |

---

## Source Modules Under Test

Tests import from these modules (to be implemented):

| Module                                      | Exports                                                       |
| ------------------------------------------- | ------------------------------------------------------------- |
| `webapp/src/lib/crypto.ts`                  | `deriveRoomAccessKey`, `encrypt`, `decrypt`, `buildAuthToken` |
| `webapp/src/lib/api.ts`                     | typed wrappers around `fetch` for each REST endpoint          |
| `backend/internal/middleware/middleware.go` | `AuthMiddleware(c *gin.Context)`                              |

---

## Running Tests

```bash
# Layer 3 — Go middleware unit tests (no infra needed)
make test-be

# Layer 1 — Crypto unit tests (no infra needed)
cd webapp && npx vitest run src/lib/crypto.test.ts

# Layer 2 — Integration tests (requires Redis + backend)
make dev-up
go run ./backend/cmd/server &
cd webapp && npx vitest run src/lib/integration.test.ts
```

Vitest config reads `BACKEND_URL` from `webapp/.env.test`. Integration test suites skip gracefully when the backend is unreachable rather than failing hard, so `make test-be` and the crypto unit tests can always run in CI without infrastructure.
