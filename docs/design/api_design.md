# **TempChat API Specification (v1.0)**

## **1. Authentication Header**

All authenticated requests (REST and WebSocket) must include the `X-TempChat-Auth` header.

**Format:** `base64url(Claims JSON).base64url(ECDSA-P384-Sign(base64url(Claims JSON), privateKey))`

**Claims Object:**

```
{
  "rid": "room-uuid",
  "uid": "user-uuid", // Null for the initial 'join' request
  "ts": 1715432000000 // Unix timestamp (milliseconds)
}
```

## **2. REST Endpoints (Go Gin)**

### **2.1 Create Room**

- **Endpoint:** `POST /v1/rooms`
- **Payload:**
  ```
  {
    "name": "<AES-GCM ciphertext (base64) of the room name>",
    "publicKey": "<ECDSA P-384 public key as JWK JSON>",
    "creatorName": "<AES-GCM ciphertext (base64) of the creator's display name>"
  }
  ```
- **Response:** `201 Created`
  ```
  {
    "roomId": "...",
    "createdAt": 1715432000,
    "expiresAt": 1715442800,
    "userId": "...",
    "joinEid": 1
  }
  ```

### **2.2 Validate & Join Room**

- **Endpoint:** `POST /v1/rooms/:roomId/join`
- **Header:** Requires `X-TempChat-Auth` signed with `privateKey`.
- **Payload:** `{ "name": "<AES-GCM ciphertext (base64) of the display name>" }`
- **Response:** `200 OK`
  ```
  {
    "userId": "user-uuid-xyz",
    "joinEid": 142,
    "room": {
      "name": "<AES-GCM ciphertext (base64) of the room name>",
      "expiresAt": 1715442800,
      "memberCount": 2,
      "maxParticipants": 5,
      "members": [
        { "uid": "user-uuid-abc", "name": "<AES-GCM ciphertext (base64) of display name>" },
        { "uid": "user-uuid-xyz", "name": "<AES-GCM ciphertext (base64) of display name>" }
      ]
    }
  }
  ```
- **Response:** `403 Forbidden` (room full)
  ```
  { "error": "room_full" }
  ```
  The client then calls `GET /v1/rooms/:roomId` and `GET /v1/boost-options` to determine whether boost purchase options should be shown.

### **2.3 Fetch Room Info (Sync API)**

- **Endpoint:** `GET /v1/rooms/:roomId`
- **Header:** Requires `X-TempChat-Auth`.
- **Description:** Used to refresh the full state of the room (e.g., after detecting a message gap). Also used by non-members after a `room_full` rejection to check current capacity before deciding whether to boost.
- **Note on `memberCount` vs `members`:** `memberCount` reflects all slots ever occupied (including users who have explicitly left), since slots are not reclaimed. `members` contains all users who have ever joined, including those who have left — departed members have a `leftAt` field set (Unix ms). This means `members.length === memberCount` and accurately reflects consumed capacity.
- **Response:** `200 OK`
  ```
  {
    "name": "<AES-GCM ciphertext (base64) of the room name>",
    "expiresAt": 1715442800,
    "memberCount": 5,
    "maxParticipants": 5,
    "maxEvents": 50,
    "members": [
      { "uid": "user-uuid-abc", "name": "<AES-GCM ciphertext (base64) of display name>" },
      { "uid": "user-uuid-xyz", "name": "<AES-GCM ciphertext (base64) of display name>" }
    ]
  }
  ```

### **2.4 Leave Room**

- **Endpoint:** `DELETE /v1/rooms/:roomId/members/me`
- **Header:** Requires `X-TempChat-Auth` with a non-null `uid`.
- **Description:** Called when a user explicitly chooses "Leave & Delete Room". Records `left_at` for the caller, appends a `left` system event, and broadcasts `user:left` to all connected clients. The user's slot remains counted in `memberCount` permanently — slots are not reclaimed.
- **Response:** `204 No Content`

### **2.5 Fetch Boost Options**

- **Endpoint:** `GET /v1/boost-options`
- **Auth:** None required (public endpoint).
- **Description:** Returns the current list of available boost options. Options are configured server-side and can change without a client update. The client uses this to render boost purchase cards and to determine (for non-members) whether any boost would raise the room's participant cap enough to allow entry.
- **Response:** `200 OK`
  ```
  [
    {
      "id": "boost_abc123",
      "name": "Plus Boost",
      "ttlMs": 86400000,
      "maxParticipants": 10,
      "maxEvents": 100,
      "price": "$2.99"
    },
    {
      "id": "boost_def456",
      "name": "Pro Boost",
      "ttlMs": 604800000,
      "maxParticipants": 50,
      "maxEvents": 100,
      "price": "$9.99"
    }
  ]
  ```

### **2.6 Boost (Payment-Triggered)**

Room boosts are applied via payment webhook callbacks (SePay / Paddle). The payment flow and webhook endpoint design are TBD. Once payment is confirmed, the server runs the atomic Lua boost script and broadcasts a `room:boosted` WebSocket event to all connected clients.

Non-members boosting from the "Room Full" screen authenticate with `uid: null` (same pattern as the initial join request), using the `privateKey` from the URL hash.

### **2.7 Fetch Events**

- **Endpoint:** `GET /v1/rooms/:roomId/events?afterEid=142`
- **Header:** Requires `X-TempChat-Auth`.
- **Params:** - `afterEid` (Optional): Integer. Returns events with `eid > afterEid`.
- **Note on Buffer Miss:** Since the event log is capped (50 free / 100 plus / 100 pro), requested eids older than the current buffer will not be returned. The client should gracefully handle gaps if the earliest returned `eid` is still greater than the expected `afterEid`.
- **Response:**
  ```
  [
    { "eid": 143, "uid": "user-uuid-abc", "msg": "cipher_blob", "ts": 1715435005000 },
    { "eid": 144, "type": "joined", "uid": "user-uuid-abc", "ts": 1715435010000 }
  ]
  ```

## **3. Real-Time Events (WebSocket)**

### **3.1 Client -> Server**

| **Event**      | **Payload**                     | **Description**          |
| -------------- | ------------------------------- | ------------------------ |
| `message:send` | `{ "m": "aes_gcm_ciphertext" }` | Sends encrypted message. |

### **3.2 Server -> Client**

| **Event**         | **Payload**                                                                                                                                                      | **Description**                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `message:received` | `{ "eid": 145, "uid": "...", "msg": "...", "ts": ts }`                                                                                                           | Standard chat message.                                                                                                                          |
| `user:joined`     | `{ "eid": 146, "type": "joined", "uid": "...", "ts": ts }`                                                                                                       | User join system event.                                                                                                                         |
| `user:left`       | `{ "eid": 147, "type": "left", "uid": "...", "ts": ts }`                                                                                                         | User leave system event.                                                                                                                        |
| `room:boosted`    | `{ "eid": 148, "type": "boosted", "uid": "..." \| null, "boostId": "boost_abc123", "expiresAt": 1715529200, "maxParticipants": 50, "maxEvents": 100, "ts": ts }` | Broadcast when a paid boost is confirmed. `uid` is null if the booster was a non-member. Clients update their local room state and status pill. |

## **4. Rate Limiting**

All limits are enforced per client IP. REST limits use Redis-backed GCRA (atomic, shared across all server instances). WebSocket message limits are per-connection in-memory.

On limit exceeded, REST endpoints return `429 Too Many Requests` with a `Retry-After` header (duration until the next token is available) and body `{ "error": "rate_limit_exceeded" }`. Redis errors fail open (request passes through).

### **4.1 REST Rate Limits**

| Endpoint | Redis key prefix | Rate | Burst | Period |
|---|---|---|---|---|
| `POST /v1/rooms` | `rl:create_room` | 5 | 3 | 10 min |
| `GET /v1/boost-options` | `rl:boost_options` | 30 | 30 | 1 min |
| `GET /v1/rooms/:roomId` | `rl:get_room` | 20 | 10 | 1 min |
| `POST /v1/rooms/:roomId/join` | `rl:join` | 10 | 5 | 1 min |
| `DELETE /v1/rooms/:roomId/members/me` | `rl:leave` | 5 | 3 | 1 min |
| `GET /v1/rooms/:roomId/events` | `rl:events` | 20 | 10 | 1 min |
| `GET /v1/rooms/:roomId/ws` (upgrade) | `rl:ws_upgrade` | 15 | 5 | 1 min |
| `GET /health` | — | none | — | — |

### **4.2 WebSocket Message Rate Limit**

`message:send` frames are limited per connection (in-memory, no Redis): **1 message per 2 seconds, burst of 5**. Exceeding the limit sends an error frame and continues — the connection is not closed to avoid reconnect storms on mobile:

```json
{ "event": "error", "code": "rate_limit_exceeded" }
```

## **5. Storage Schemas (Redis)**

See [redis_design.md](redis_design.md) for the full key schema.
