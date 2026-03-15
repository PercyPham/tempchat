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
11. [Hardening checklist](#11-hardening-checklist)

---

## 1. Stack overview

| Layer                | Technology                               |
| -------------------- | ---------------------------------------- |
| Frontend framework   | React + Vite + TypeScript                |
| Frontend hosting     | Firebase Hosting                         |
| HTTP router          | Go + Gin                                 |
| WebSocket            | github.com/coder/websocket               |
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

Go with Gin as the HTTP router and `github.com/coder/websocket` for WebSocket connections.

**Dependencies:**

```
github.com/gin-gonic/gin
github.com/coder/websocket
github.com/redis/go-redis/v9
github.com/google/uuid
```

**Basic server setup:**

```go
func wsHandler(c *gin.Context) {
    // Accept validates the Origin header against the allowed list.
    conn, err := websocket.Accept(c.Writer, c.Request, &websocket.AcceptOptions{
        OriginPatterns: strings.Split(os.Getenv("ALLOWED_ORIGINS"), ","),
    })
    if err != nil {
        return
    }
    defer conn.CloseNow()

    ctx := c.Request.Context()

    // Keepalive: ping every 54s so Nginx never closes an idle connection.
    // (Nginx proxy_read_timeout is 604800s, but we ping well before that.)
    go func() {
        ticker := time.NewTicker(54 * time.Second)
        defer ticker.Stop()
        for {
            select {
            case <-ticker.C:
                pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
                conn.Ping(pingCtx)
                cancel()
            case <-ctx.Done():
                return
            }
        }
    }()

    for {
        _, msg, err := conn.Read(ctx)
        if err != nil {
            break // client disconnected or context cancelled
        }
        // parse msg, validate X-TempChat-Auth, broadcast to room
    }
}

func main() {
    // gin.Default() includes Logger + Recovery (panic → 500, no crash).
    r := gin.Default()

    // Reject bodies larger than 4 KB for REST endpoints.
    r.MaxMultipartMemory = 4 << 10

    r.POST("/api/rooms", createRoom)
    r.POST("/api/rooms/:roomId/join", joinRoom)
    r.GET("/api/rooms/:roomId", getRoom)
    r.GET("/api/rooms/:roomId/events", getEvents)
    r.GET("/api/boost-options", getBoostOptions)
    r.GET("/health", func(c *gin.Context) { c.Status(http.StatusOK) })
    r.GET("/ws", wsHandler)
    r.Run("127.0.0.1:" + os.Getenv("PORT"))
}
```

**Environment variables (set in systemd service):**

| Variable          | Example value                         |
| ----------------- | ------------------------------------- |
| `PORT`            | `8080`                                |
| `REDIS_ADDR`      | `127.0.0.1:6379`                      |
| `ALLOWED_ORIGINS` | `https://app.yourdomain.com`          |
| `GIN_MODE`        | `release`                             |

---

## 4. Real-time events

See [api_design.md](api_design.md) for the full WebSocket event spec.

---

## 5. Storage

Redis only — no relational database required for MVP.

See [redis_design.md](redis_design.md) for the full key schema.

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

### Step 1 — Initial system setup

```bash
apt update && apt upgrade -y
apt install -y ufw fail2ban unattended-upgrades
```

Enable automatic security patches:

```bash
dpkg-reconfigure --priority=low unattended-upgrades
# Accept the defaults — this enables automatic security updates only.
```

### Step 2 — SSH hardening

Edit `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin no
```

Restart SSH and verify you can still log in with your key before closing the session:

```bash
systemctl restart sshd
```

fail2ban ships with an SSH jail enabled by default on Ubuntu. Verify it is active:

```bash
fail2ban-client status sshd
```

### Step 3 — Firewall (UFW)

Allow only the three ports the server needs; deny everything else:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP → HTTPS redirect
ufw allow 443/tcp    # HTTPS + WSS
ufw enable
ufw status
```

### Step 4 — Redis

Redis must only bind to localhost — never expose it publicly:

```bash
# /etc/redis/redis.conf
bind 127.0.0.1

# Cap memory so Redis cannot starve the Go process on a 1 GB droplet.
maxmemory 128mb
maxmemory-policy allkeys-lru

# Required for room expiry cleanup (keyspace notifications).
notify-keyspace-events Ex
```

Restart Redis after editing:

```bash
systemctl restart redis
```

### Step 5 — systemd service

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
Environment=ALLOWED_ORIGINS=https://app.yourdomain.com

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

### Rate-limiting zones (nginx.conf)

Add the following inside the existing `http { }` block in `/etc/nginx/nginx.conf`:

```nginx
# Rate limiting: max 20 REST requests/second per IP, burst of 40.
limit_req_zone  $binary_remote_addr  zone=api:10m  rate=20r/s;

# Connection limiting: max 10 simultaneous WebSocket connections per IP.
limit_conn_zone $binary_remote_addr  zone=ws:10m;
```

### Site config

Create `/etc/nginx/sites-available/tempchat`:

```nginx
server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff"                             always;
    add_header X-Frame-Options           "DENY"                                always;
    add_header Referrer-Policy           "no-referrer"                         always;

    # WebSocket endpoint
    location /ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # Required to pass the WebSocket upgrade handshake through Nginx.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host       $host;
        proxy_set_header X-Real-IP  $remote_addr;

        # Must exceed the maximum room lifetime (pro tier = 7 days = 604800s).
        # Nginx default is 60s — it will silently kill idle WS connections.
        proxy_read_timeout 604800s;
        proxy_send_timeout 604800s;

        # Limit concurrent WebSocket connections per IP.
        limit_conn ws 10;
    }

    # REST API
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host      $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Reject bodies larger than 4 KB.
        client_max_body_size 4k;

        # Rate limiting — allow short bursts, queue excess, reject beyond that.
        limit_req zone=api burst=40 nodelay;
    }

    # Health check (no rate limiting, no auth)
    location /health {
        proxy_pass http://127.0.0.1:8080;
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

---

## 11. Hardening checklist

Run through this after every fresh deployment:

- [ ] UFW enabled — only ports 22, 80, 443 open (`ufw status`)
- [ ] SSH password auth disabled (`grep PasswordAuthentication /etc/ssh/sshd_config`)
- [ ] fail2ban active for SSH (`fail2ban-client status sshd`)
- [ ] unattended-upgrades enabled (`systemctl status unattended-upgrades`)
- [ ] Redis bound to localhost only (`redis-cli CONFIG GET bind`)
- [ ] Redis `maxmemory` set (`redis-cli CONFIG GET maxmemory`)
- [ ] Redis keyspace notifications on (`redis-cli CONFIG GET notify-keyspace-events`)
- [ ] `ALLOWED_ORIGINS` set correctly in systemd service
- [ ] `GIN_MODE=release` set in systemd service
- [ ] Nginx config valid (`nginx -t`)
- [ ] TLS certificate issued and auto-renewal configured (`certbot renew --dry-run`)
- [ ] Health check reachable (`curl https://api.yourdomain.com/health`)
