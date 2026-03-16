# TempChat — Tech Stack

## Table of contents

1. [Stack overview](#1-stack-overview)
2. [Frontend](#2-frontend)
3. [Backend](#3-backend)
4. [Real-time events](#4-real-time-events)
5. [Storage](#5-storage)
6. [Local development](#6-local-development)
7. [Testing](#7-testing)

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

> **Why not Docker Compose in production?** On a 1 GB droplet, the Docker daemon + containerd adds ~50–100 MB of overhead — memory taken directly from Go's goroutine heap. With systemd + system Redis, that memory stays available for WebSocket connections. Docker Compose remains the right choice for local development only.

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

    v1 := r.Group("/v1")
    v1.POST("/rooms", createRoom)
    v1.POST("/rooms/:roomId/join", joinRoom)
    v1.GET("/rooms/:roomId", getRoom)
    v1.GET("/rooms/:roomId/events", getEvents)
    v1.GET("/boost-options", getBoostOptions)
    v1.GET("/health", func(c *gin.Context) { c.Status(http.StatusOK) })
    v1.GET("/rooms/:roomId/ws", wsHandler)
    r.Run("127.0.0.1:" + os.Getenv("PORT"))
}
```

**Environment variables (set in systemd service):**

| Variable          | Example value                |
| ----------------- | ---------------------------- |
| `PORT`            | `8080`                       |
| `REDIS_ADDR`      | `127.0.0.1:6379`             |
| `ALLOWED_ORIGINS` | `https://app.yourdomain.com` |
| `GIN_MODE`        | `release`                    |
| `GOMAXPROCS`      | `1`                          |

> **`GOMAXPROCS=1`**: The droplet has a single vCPU. Setting this prevents the Go runtime from spinning additional OS threads, reducing scheduler overhead with no throughput cost.

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
      - "6379:6379"

  redisinsight:
    image: redis/redisinsight:latest
    ports:
      - "5540:5540"
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

## 7. Testing

### Commands

| Command                | What it runs                                                         |
| ---------------------- | -------------------------------------------------------------------- |
| `make test`            | All three suites in sequence: `test-be` → `test-wa` → `test-integration` |
| `make test-be`         | `cd backend && go test ./...`                                        |
| `make test-wa`         | Vitest unit tests (`webapp/src/lib/crypto.test.ts`)                  |
| `make test-integration`| Starts the test server, then runs `webapp/src/lib/integration.test.ts` |

### Webapp (Vitest 4.1.0)

Framework: **Vitest** running in the Node environment.

**Unit tests** — `webapp/src/lib/crypto.test.ts`

Covers the full client-side crypto layer without any network or infrastructure:

- `deriveRoomAccessKey()` — determinism and key uniqueness across different inputs
- `encryptMessage()` / `decryptMessage()` — UTF-8 round-trips, empty strings, IV uniqueness, wrong-key rejection
- `genAuthToken()` — base64url format, claim structure, null uid support, determinism

**Integration tests** — `webapp/src/lib/integration.test.ts`

Requires the test server (started automatically by `make test-integration`). Tests the full auth token flow end-to-end:

- Valid token accepted — claims echoed back correctly
- Expired / future tokens rejected (outside the ±5000 ms drift window)
- Tampered signatures rejected
- Malformed and empty tokens rejected
- Null uid join tokens accepted

Environment variables for integration tests live in `webapp/.env.test` (`BACKEND_URL=http://localhost:8081`). Tests skip gracefully if the test server is unreachable.

### Backend (Go)

**Unit tests** — `go test ./...`

Standard Go testing framework. Run via `make test-be`.

**Integration — test server** — `backend/cmd/testserver`

A minimal Gin server that runs on port **8081** (separate from the production backend on 8080). It exposes a single endpoint used by the webapp integration tests:

```
POST /v1/test/echo-claims
```

The handler calls `auth.VerifyRoomAccessToken()` — the same function used by the production auth middleware — and echoes the decoded claims back to the caller. This lets the webapp integration tests verify that tokens generated client-side are accepted by the real server-side validation logic.

Configuration is loaded from `backend/.env.test`:

| Variable          | Value                  |
| ----------------- | ---------------------- |
| `APP_MODE`        | `test`                 |
| `PORT`            | `8081`                 |
| `ALLOWED_ORIGINS` | `http://localhost:5173`|
| `REDIS_ADDR`      | `127.0.0.1:6379`       |

The test server requires a running Redis instance. Start it with `make dev-up` before running integration tests manually.
