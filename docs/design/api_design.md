# **TempChat API Specification (v1.0)**

## **1. Authentication Header**

All authenticated requests (REST and WebSocket) must include the `X-TempChat-Auth` header.

**Format:** `base64url(Claims JSON).base64url(HMAC-SHA256(base64url(Claims JSON), roomAccessKey))`

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
    "name": "Project X Sync",
    "accessKey": "pbkdf2_derived_rak_string"
  }
  ```
- **Response:** `201 Created`
  ```
  {
    "roomId": "...",
    "createdAt": 1715432000,
    "expiresAt": 1715442800
  }
  ```

### **2.2 Validate & Join Room**

- **Endpoint:** `POST /v1/rooms/:roomId/join`
- **Header:** Requires `X-TempChat-Auth` signed with `roomAccessKey`.
- **Payload:** `{ "displayName": "Alice" }`
- **Response:** `200 OK`
  ```
  {
    "userId": "user-uuid-xyz",
    "joinEid": 142,
    "room": {
      "name": "Project X Sync",
      "expiresAt": 1715442800,
      "memberCount": 2,
      "maxParticipants": 5,
      "members": [
        { "uid": "user-uuid-abc", "name": "Bob" },
        { "uid": "user-uuid-xyz", "name": "Alice" }
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
- **Response:** `200 OK`
  ```
  {
    "name": "Project X Sync",
    "expiresAt": 1715442800,
    "memberCount": 5,
    "maxParticipants": 5,
    "maxEvents": 50,
    "members": [
      { "uid": "user-uuid-abc", "name": "Bob" },
      { "uid": "user-uuid-xyz", "name": "Alice" }
    ]
  }
  ```

### **2.4 Fetch Boost Options**

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

### **2.5 Boost (Payment-Triggered)**

Room boosts are applied via payment webhook callbacks (SePay / Paddle). The payment flow and webhook endpoint design are TBD. Once payment is confirmed, the server runs the atomic Lua boost script and broadcasts a `room:boosted` WebSocket event to all connected clients.

Non-members boosting from the "Room Full" screen authenticate with `uid: null` (same pattern as the initial join request), using the `roomAccessKey` from the URL hash.

### **2.6 Fetch Events**

- **Endpoint:** `GET /v1/rooms/:roomId/events?afterEid=142`
- **Header:** Requires `X-TempChat-Auth`.
- **Params:** - `afterEid` (Optional): Integer. Returns events with `eid > afterEid`.
- **Note on Buffer Miss:** Since the event log is capped (50 free / 100 plus / 100 pro), requested eids older than the current buffer will not be returned. The client should gracefully handle gaps if the earliest returned `eid` is still greater than the expected `afterEid`.
- **Response:**
  ```
  [
    { "eid": 143, "uid": "user-uuid-abc", "msg": "cipher_blob", "ts": 1715435005 },
    { "eid": 144, "type": "joined", "uid": "user-uuid-abc", "ts": 1715435010 }
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
| `message:receive` | `{ "eid": 145, "uid": "...", "msg": "...", "ts": ts }`                                                                                                           | Standard chat message.                                                                                                                          |
| `user:joined`     | `{ "eid": 146, "type": "joined", "uid": "...", "ts": ts }`                                                                                                       | User join system event.                                                                                                                         |
| `user:left`       | `{ "eid": 147, "type": "left", "uid": "...", "ts": ts }`                                                                                                         | User leave system event.                                                                                                                        |
| `room:boosted`    | `{ "eid": 148, "type": "boosted", "uid": "..." \| null, "boostId": "boost_abc123", "expiresAt": 1715529200, "maxParticipants": 50, "maxEvents": 100, "ts": ts }` | Broadcast when a paid boost is confirmed. `uid` is null if the booster was a non-member. Clients update their local room state and status pill. |

## **4. Storage Schemas (Redis)**

See [redis_design.md](redis_design.md) for the full key schema.
