# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TempChat is a zero-knowledge, short-lived encrypted chat PWA. Users create ephemeral rooms, invite others via QR code, and all messages are encrypted client-side (AES-GCM). Rooms auto-expire based on tier (Free 1h / Plus Boost 24h / Pro Boost 7d).

## Repo Structure

- `backend/` — Go + Gin REST/WebSocket API
- `webapp/` — React + Vite + TypeScript PWA (Firebase Hosting)
- `site/` — Marketing/landing site (Firebase Hosting)
- `docs/design/` — Architecture and design specs (authoritative reference)
- `scripts/` — Deployment and utility scripts
- `docker-compose.dev.yml` — Dev infrastructure (Redis + RedisInsight)

## Common Commands

```bash
make dev          # Start full dev environment (Redis + backend hot-reload + webapp)
make dev-up       # Start Redis + RedisInsight only
make dev-down     # Stop infrastructure

make build-be     # Compile Go backend
make build-wa     # Build React webapp

make test-be      # Run Go tests
make typecheck-wa # tsc --noEmit on webapp
make typecheck-be # go vet on backend

make deploy-wa    # Deploy webapp to Firebase Hosting
make deploy-site  # Deploy marketing site to Firebase Hosting
```

**Prerequisites:** Go 1.22+, Node.js 20+, Docker, `air` (Go hot-reload), Firebase CLI.

## Architecture

### Frontend (webapp)
React + Vite + TypeScript PWA. All crypto runs client-side:
- Room access key derived via **PBKDF2-HMAC-SHA-512** (roomId + passphrase → roomAccessKey)
- Messages encrypted with **AES-GCM** using the roomAccessKey
- Request signing uses **HMAC-SHA-256**: `X-TempChat-Auth: Base64(claims).HMAC-SHA-256(claims, roomAccessKey)`

### Backend (backend)
Go + Gin HTTP server with `coder/websocket` for real-time events. The backend is **zero-knowledge** — it never sees plaintext messages or the roomAccessKey.

Key REST endpoints:
- `POST /api/rooms` — create room
- `POST /api/rooms/:roomId/join` — join (returns 403 `room_full` if at capacity)
- `GET /api/rooms/:roomId/events` — fetch encrypted events
- WebSocket at `/api/rooms/:roomId/ws` — real-time events

### Storage (Redis)
All room state lives in Redis with TTL-based expiry. Key schema per room:
- `room:{roomId}:meta` — hash of room config
- `room:{roomId}:users` — hash of member registry
- `room:{roomId}:events` — sorted set of encrypted messages (by seq)
- `room:{roomId}:event_seq` — monotonic counter
- `room:{roomId}:keys` — cleanup registry

Boost logic (additive expiry, MAX-based cap updates) is implemented as an atomic Lua script. Keyspace notifications trigger cleanup of all room keys on expiry.

### Boost/Monetization
Three tiers stack additively on expiry (not from now): Free → Plus Boost (+24h, 20 users) → Pro Boost (+7d, 100 users). User/event caps use MAX logic.

## Design Docs

Authoritative references in `docs/design/`:
- `system_design.md` — security model, tier logic, roadmap
- `api_design.md` — full REST + WebSocket spec with schemas
- `redis_design.md` — key schema, TTL strategy, Lua boost script
- `techstack_draft.md` — infra, deployment (DigitalOcean + Nginx + systemd)
- `user_interaction_flows.md` — mobile UX flows
