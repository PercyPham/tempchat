# **TempChat API Specification (v1.0)**

## **1. Authentication Header**

All authenticated requests (REST and Socket.io) must include the `X-TempChat-Auth` header.

**Format:** `Base64(Claims JSON).HMAC-SHA256-Hex(Base64(Claims JSON), roomAccessKey)`

**Claims Object:**

```
{
  "rid": "room-uuid",
  "uid": "user-uuid", // Null for the initial 'join' request
  "ts": 1715432000    // Unix timestamp (seconds)
}
```

## **2. REST Endpoints (Express.js)**

### **2.1 Create Room**

- **Endpoint:** `POST /api/rooms`
- **Payload:**
  ```
  {
    "groupName": "Project X Sync",
    "roomAccessKey": "pbkdf2_derived_rak_string"
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

- **Endpoint:** `POST /api/rooms/:roomId/join`
- **Header:** Requires `X-TempChat-Auth` signed with `roomAccessKey`.
- **Payload:** `{ "displayName": "Alice" }`
- **Response:** `200 OK`
  ```
  {
    "userId": "user-uuid-xyz",
    "lastMessageId": 142,
    "group": {
      "name": "Project X Sync",
      "expiresAt": 1715442800,
      "members": [
        { "uid": "user-uuid-abc", "name": "Bob" },
        { "uid": "user-uuid-xyz", "name": "Alice" }
      ]
    }
  }
  ```

### **2.3 Fetch Group Info (Sync API)**

- **Endpoint:** `GET /api/rooms/:roomId`
- **Header:** Requires `X-TempChat-Auth`.
- **Description:** Used to refresh the full state of the room (e.g., after detecting a message gap).
- **Response:** `200 OK`
  ```
  {
    "name": "Project X Sync",
    "expiresAt": 1715442800,
    "members": [
      { "uid": "user-uuid-abc", "name": "Bob" },
      { "uid": "user-uuid-xyz", "name": "Alice" }
    ]
  }
  ```

### **2.4 Fetch Message History**

- **Endpoint:** `GET /api/rooms/:roomId/history?afterId=142`
- **Header:** Requires `X-TempChat-Auth`.
- **Params:** - `afterId` (Optional): Integer. Returns messages with `id > afterId`.
- **Note on Buffer Miss:** Since Redis history is capped (e.g., last 50-100 messages), requested IDs older than the current buffer will not be returned. The client should gracefully handle gaps if the earliest returned ID is still greater than the expected `afterId`.
- **Response:**
  ```
  [
    { "id": 143, "t": 1715435005, "m": "cipher_blob", "uid": "user-uuid-abc" },
    { "id": 144, "t": 1715435010, "uid": "user-uuid-abc", "uname": "user-name-abc", "type": "user_joined" }
  ]
  ```

## **3. Real-Time Events (Socket.io)**

### **3.1 Client -> Server**

| **Event**      | **Payload**                     | **Description**          |
| -------------- | ------------------------------- | ------------------------ |
| `message:send` | `{ "m": "aes_gcm_ciphertext" }` | Sends encrypted message. |

### **3.2 Server -> Client**

| **Event**         | **Payload**                                        | **Description**        |
| ----------------- | -------------------------------------------------- | ---------------------- |
| `message:receive` | `{ "id": 145, "t": ts, "m": "...", "uid": "..." }` | Standard chat message. |

## **4. Storage Schemas (Redis)**

| **Key**             | **Type** | **Fields / Structure**                                                                          |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `room:[id]:meta`    | Hash     | `rak`, `name`, `maxUsers`, `createdAt`, `expiresAt`, `msgCounter`                               |
| `room:[id]:members` | Hash     | `uid` -> `JSON.stringify({name, lastMsgIdAtJoin})`                                              |
| `room:[id]:history` | List     | JSON strings: `{"id": seq, "t": ts, "m": "...", "uid": "..."}`. System events include `"type"`. |
