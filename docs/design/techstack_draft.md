# TempChat — Tech Stack & Infrastructure Guide

## Table of contents

1. [Stack overview](#1-stack-overview)
2. [Frontend](#2-frontend)
3. [Backend](#3-backend)
4. [Real-time events](#4-real-time-events)
5. [Storage](#5-storage)
6. [Local development](#6-local-development)
7. [Production deployment](#7-production-deployment)
8. [Nginx configuration](#8-nginx-configuration)
9. [TLS with Let's Encrypt](#9-tls-with-lets-encrypt)
10. [Cost summary](#10-cost-summary)

---

## 1. Stack overview

| Layer                | Technology                               |
| -------------------- | ---------------------------------------- |
| Frontend framework   | React + Vite + TypeScript                |
| Frontend hosting     | Firebase Hosting                         |
| HTTP router          | Go + Gin                                 |
| WebSocket            | gorilla/websocket                        |
| Storage              | Redis (self-hosted)                      |
| Redis GUI (dev only) | RedisInsight                             |
| Dev infrastructure   | Docker Compose                           |
| Production server    | DigitalOcean Droplet — Singapore ($6/mo) |
| Reverse proxy        | Nginx                                    |
| TLS certificate      | Let's Encrypt + certbot                  |

---

## 2. Frontend

React + Vite + TypeScript, deployed as a PWA to Firebase Hosting.

**Dependencies:**

```
react
react-dom
typescript
vite
tailwindcss
zustand
```

The **Web Crypto API** (built into all modern browsers) handles all cryptographic operations — no external crypto library is needed:

| Operation                              | API                   |
| -------------------------------------- | --------------------- |
| Message encryption / decryption        | `AES-GCM`             |
| Deriving `roomAccessKey` from `secret` | `PBKDF2-HMAC-SHA-512` |
| Signing `X-TempChat-Auth` header       | `HMAC-SHA-256`        |

**Deploy:**

```bash
npm run build
firebase deploy --only hosting
```

---

## 3. Backend

Go with Gin as the HTTP router and `gorilla/websocket` for WebSocket connections.

**Dependencies:**

```
github.com/gin-gonic/gin
github.com/gorilla/websocket
github.com/go-redis/redis/v9
github.com/google/uuid
```

**Basic server setup:**

```go
var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool {
        // validate against your allowed origins
        return true
    },
}

func wsHandler(c *gin.Context) {
    conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
    if err != nil {
        return
    }
    defer conn.Close()

    for {
        _, msg, err := conn.ReadMessage()
        if err != nil {
            break // client disconnected
        }
        // parse msg, validate X-TempChat-Auth, broadcast to room
    }
}

func main() {
    r := gin.Default()
    r.POST("/api/rooms", createRoom)
    r.POST("/api/rooms/:roomId/join", joinRoom)
    r.GET("/api/rooms/:roomId", getRoom)
    r.GET("/api/rooms/:roomId/history", getHistory)
    r.GET("/ws", wsHandler)
    r.Run(":8080")
}
```

---

## 4. Real-time events

WebSocket messages use a JSON envelope with a `type` field, allowing all event types to flow over the same connection.

**Client → Server**

```json
{ "type": "message:send", "m": "aes_gcm_ciphertext" }
```

**Server → Client**

```json
{ "type": "message:receive", "id": 145, "t": 1715435005, "m": "...", "uid": "..." }
{ "type": "user_joined",     "id": 146, "t": 1715435010, "uid": "...", "uname": "Alice" }
```

**Client usage (native WebSocket API):**

```ts
const ws = new WebSocket('wss://api.yourdomain.com/ws');

ws.send(JSON.stringify({ type: 'message:send', m: ciphertext }));

ws.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'message:receive') handleMessage(data);
  if (data.type === 'user_joined') handleUserJoined(data);
};
```

---

## 5. Storage

Redis only — no relational database required for MVP.

| Key                 | Type | Contents                                                          |
| ------------------- | ---- | ----------------------------------------------------------------- |
| `room:[id]:meta`    | Hash | `rak`, `name`, `maxUsers`, `createdAt`, `expiresAt`, `msgCounter` |
| `room:[id]:members` | Hash | `uid` → `JSON({name, lastMsgIdAtJoin})`                           |
| `room:[id]:history` | List | JSON message blobs, capped to last 50–100 via `LTRIM`             |

All keys have a Redis `EXPIRE` matching the room's `expiresAt` — data self-destructs automatically with no cleanup job needed.

---

## 6. Local development

Docker Compose manages the infrastructure only (Redis + RedisInsight). The frontend and backend run directly on the host for faster iteration.

**`docker-compose.yml`:**

```yaml
services:
  redis:
    image: redis:8-alpine
    ports:
      - '6379:6379'

  redisinsight:
    image: redis/redisinsight:latest
    ports:
      - '5540:5540'
    depends_on:
      - redis
```

**Start infrastructure:**

```bash
docker compose up
```

**Run frontend and backend in separate terminals:**

```bash
# Terminal 1 — frontend
cd frontend && npm run dev

# Terminal 2 — backend
cd backend && go run ./cmd/server
```

**Services:**

| Service             | URL                   |
| ------------------- | --------------------- |
| Frontend (Vite HMR) | http://localhost:5173 |
| Backend (Go/Gin)    | http://localhost:8080 |
| Redis               | localhost:6379        |
| RedisInsight        | http://localhost:5540 |

In RedisInsight, connect to host `localhost`, port `6379`.

---

## 7. Production deployment

### Droplet spec

| Setting  | Value                               |
| -------- | ----------------------------------- |
| Provider | DigitalOcean                        |
| Region   | Singapore (SGP1)                    |
| Plan     | Basic — 1 vCPU, 1 GB RAM, 25 GB SSD |
| OS       | Ubuntu 24.04 LTS                    |
| Services | Nginx, Go binary (systemd), Redis   |

Redis must only bind to localhost — never expose it publicly:

```bash
# /etc/redis/redis.conf
bind 127.0.0.1
```

### Traffic flow

```
Browser
  │  wss://api.yourdomain.com/ws      (port 443, TLS)
  │  https://api.yourdomain.com/api/  (port 443, TLS)
  ▼
Nginx  ←  TLS termination
  │  ws://127.0.0.1:8080/ws           (internal only)
  │  http://127.0.0.1:8080/api/       (internal only)
  ▼
Go (Gin)  ←  127.0.0.1:8080
  │
  ▼
Redis  ←  127.0.0.1:6379
```

### systemd service

Create a dedicated system user and place the compiled binary:

```bash
useradd -r -s /bin/false tempchat
mkdir -p /opt/tempchat
cp ./server /opt/tempchat/server
chown -R tempchat:tempchat /opt/tempchat
```

Create `/etc/systemd/system/tempchat.service`:

```ini
[Unit]
Description=TempChat Go server
After=network.target

[Service]
Type=simple
User=tempchat
WorkingDirectory=/opt/tempchat
ExecStart=/opt/tempchat/server
Restart=on-failure
RestartSec=5
Environment=GIN_MODE=release
Environment=REDIS_ADDR=127.0.0.1:6379
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable tempchat
systemctl start tempchat
```

View live logs:

```bash
journalctl -u tempchat -f
```

---

## 8. Nginx configuration

Install Nginx:

```bash
apt update && apt install nginx -y
```

Create `/etc/nginx/sites-available/tempchat`:

```nginx
server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # WebSocket endpoint
    location /ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # Required to pass the WebSocket upgrade handshake through Nginx.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Must exceed the maximum room lifetime (free tier = 5 hours).
        # Nginx default is 60s — it will silently kill idle WS connections.
        proxy_read_timeout 18000s;
        proxy_send_timeout 18000s;
    }

    # REST API
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

Enable the site and reload:

```bash
ln -s /etc/nginx/sites-available/tempchat /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

---

## 9. TLS with Let's Encrypt

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d api.yourdomain.com
```

Certbot edits the Nginx config automatically and installs a systemd timer for auto-renewal. Test renewal anytime with:

```bash
certbot renew --dry-run
```

---

## 10. Cost summary

| Item                              | Cost       |
| --------------------------------- | ---------- |
| Firebase Hosting                  | Free       |
| DigitalOcean Droplet (Go + Redis) | $6/mo      |
| Let's Encrypt TLS                 | Free       |
| **Total**                         | **~$6/mo** |
