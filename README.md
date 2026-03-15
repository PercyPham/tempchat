# TempChat

A zero-knowledge, short-lived chat web application designed for immediate, real-world social interactions. It facilitates group communication without requiring phone numbers, app downloads, or permanent data footprints.

---

## Repo Structure

```
tempchat/
├── webapp/                   # React + Vite + TypeScript PWA → app.tempchat.app
│   └── .env.example
├── backend/                  # Go + Gin + coder/websocket   → api.tempchat.app
│   ├── .env.example
│   └── .air.toml             # air hot-reload config
├── site/                     # Plain HTML/CSS/JS             → tempchat.app
├── scripts/
│   └── dev.sh                # dev startup script
├── docker-compose.dev.yml    # Redis + RedisInsight (dev only)
├── Makefile
└── docs/
    └── design/               # Architecture & API specs
```

---

## Prerequisites

| Tool | Purpose |
|---|---|
| [Go 1.22+](https://go.dev/dl/) | Backend |
| [Node.js 20+](https://nodejs.org/) | Webapp |
| [Docker](https://www.docker.com/) | Dev infrastructure (Redis) |
| [air](https://github.com/air-verse/air) | Go hot-reload (`go install github.com/air-verse/air@latest`) |
| [Firebase CLI](https://firebase.google.com/docs/cli) | Deployment (`npm i -g firebase-tools`) |

---

## Development

### 1. Set up env files

```bash
cp backend/.env.example backend/.env
cp webapp/.env.example  webapp/.env
```

### 2. Install webapp dependencies

```bash
cd webapp && npm install
```

### 3. Start everything

```bash
make dev
```

This single command:
- Starts Redis + RedisInsight via Docker Compose (if not already running)
- Starts the Go backend with `air` (hot-reload on file changes)
- Starts the Vite dev server (HMR)
- Streams all logs to the same terminal — `Ctrl+C` stops everything cleanly

### Dev services

| Service | URL |
|---|---|
| Webapp (Vite HMR) | http://localhost:5173 |
| Backend (Go/Gin) | http://localhost:8080 |
| Redis | localhost:6379 |
| RedisInsight | http://localhost:5540 |

To start/stop infrastructure only (Redis + RedisInsight):

```bash
make dev-up
make dev-down
```

---

## Production

| Service | URL | Platform |
|---|---|---|
| Webapp | https://app.tempchat.app | Firebase Hosting |
| Backend | https://api.tempchat.app | DigitalOcean Droplet (Singapore) |
| Site | https://tempchat.app | Firebase Hosting |

Both `app.tempchat.app` and `tempchat.app` are served from the same Firebase project using multi-site Hosting targets.

### Deploy

```bash
make deploy-webapp   # builds webapp → deploys to app.tempchat.app
make deploy-site     # deploys site/ → tempchat.app
make build-backend   # compiles Go binary → backend/bin/server
```

For backend deployment, copy `backend/bin/server` to the DigitalOcean droplet and restart the systemd service. See [`docs/design/techstack_draft.md`](docs/design/techstack_draft.md) for the full server setup guide.

---

## Makefile Reference

```
make dev             Start full dev environment (infra + backend + webapp)
make dev-up          Start Redis + RedisInsight only
make dev-down        Stop Redis + RedisInsight
make webapp-build    Build webapp for production
make deploy-webapp   Build + deploy webapp to Firebase (app.tempchat.app)
make deploy-site     Deploy site to Firebase (tempchat.app)
make build-backend   Compile Go binary
make help            Show this list
```

---

## Design Docs

- [`docs/design/system_design.md`](docs/design/system_design.md) — Product overview, security architecture, business rules
- [`docs/design/api_design.md`](docs/design/api_design.md) — REST endpoints & WebSocket events
- [`docs/design/redis_design.md`](docs/design/redis_design.md) — Redis key schema, TTL strategy, boost logic
- [`docs/design/techstack_draft.md`](docs/design/techstack_draft.md) — Tech stack, infra guide, Nginx config, TLS
- [`docs/design/user_interaction_flows.md`](docs/design/user_interaction_flows.md) — Mobile UX flows
