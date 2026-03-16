.PHONY: dev dev-be dev-wa dev-up dev-down dev-gui \
        build build-wa build-be \
        deploy-wa deploy-site \
        test test-be test-wa test-integration \
        typecheck typecheck-wa typecheck-be \
        help

# ── Dev servers ───────────────────────────────────────────────────────────────

dev:          ## Start everything: Redis + backend (air) + webapp (vite)
	@bash scripts/dev.sh

dev-be:       ## Start Redis + backend only (air)
	@bash scripts/backend.sh

dev-wa:       ## Start webapp dev server only (vite)
	@bash scripts/webapp.sh

# ── Infrastructure ────────────────────────────────────────────────────────────

dev-up:       ## Start Redis + RedisInsight via Docker Compose
	docker compose -f docker-compose.dev.yml up -d

dev-down:     ## Stop dev infrastructure
	docker compose -f docker-compose.dev.yml down

dev-gui:      ## Open RedisInsight GUI in the browser
	open http://localhost:5540

# ── Build ─────────────────────────────────────────────────────────────────────

build:        ## Build everything (backend + webapp)
	@$(MAKE) build-be build-wa

build-be:     ## Compile the Go binary
	cd backend && go build -o bin/server ./cmd/server

build-wa:     ## Build the webapp for production
	cd webapp && pnpm build

# ── Deploy ────────────────────────────────────────────────────────────────────

deploy-wa:    ## Deploy webapp to Firebase Hosting (app.tempchat.app)
	cd webapp && pnpm build && firebase deploy --only hosting:webapp

deploy-site:  ## Deploy site to Firebase Hosting (tempchat.app)
	firebase deploy --only hosting:site

# ── Test ──────────────────────────────────────────────────────────────────────

test:         ## Run all tests
	@$(MAKE) test-be test-wa test-integration

test-be:      ## Run Go tests
	cd backend && go test ./...

test-wa:      ## Run webapp crypto unit tests (no infra needed)
	cd webapp && pnpm exec vitest run src/lib/crypto.test.ts

test-integration: ## Run webapp integration tests (starts test server on :8081, no Redis needed)
	@echo "Starting test server (backend/.env.test)..."
	@cd backend && go run ./cmd/testserver & \
	  BE_PID=$$!; \
	  sleep 1 && \
	  cd webapp && pnpm exec vitest run src/lib/integration.test.ts; \
	  STATUS=$$?; \
	  kill $$BE_PID 2>/dev/null; \
	  exit $$STATUS

# ── Typecheck ─────────────────────────────────────────────────────────────────

typecheck:    ## Type-check frontend (tsc) + backend (go vet)
	@$(MAKE) typecheck-wa typecheck-be

typecheck-wa: ## TypeScript type-check via vite build (catches missing `type` imports)
	cd webapp && pnpm build

typecheck-be: ## Go vet backend
	cd backend && go vet ./...

# ── Default ───────────────────────────────────────────────────────────────────

help:         ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
