.PHONY: dev dev-be dev-wa dev-up dev-down dev-gui \
        build build-wa build-be \
        deploy-wa deploy-site \
        serve-site \
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

serve-site:   ## Serve marketing site locally via Firebase
	firebase serve --only hosting:site

# ── Test ──────────────────────────────────────────────────────────────────────

test:         ## Run all tests
	@$(MAKE) test-be test-wa test-integration

test-be:      ## Run Go tests
	cd backend && go test ./...

test-wa:      ## Run webapp crypto unit tests (no infra needed)
	cd webapp && pnpm exec vitest run src/lib/crypto.test.ts

test-integration: ## Run webapp integration tests (starts Redis + two test server instances on :8081 and :8082)
	@echo "Ensuring test Redis is running..."
	docker compose -f $(CURDIR)/docker-compose.test.yml up -d
	@echo "Starting test server instances on :8081 and :8082..."
	@lsof -ti :8081 | xargs kill 2>/dev/null; true
	@lsof -ti :8082 | xargs kill 2>/dev/null; true
	@(cd backend && go run ./cmd/testserver) & \
	  (cd backend && PORT=8082 go run ./cmd/testserver) & \
	  echo "Waiting for both instances to be healthy..."; \
	  for i in $$(seq 1 40); do \
	    curl -sf http://localhost:8081/v1/health > /dev/null 2>&1 && \
	    curl -sf http://localhost:8082/v1/health > /dev/null 2>&1 && break; \
	    sleep 0.5; \
	  done; \
	  cd webapp && pnpm exec vitest run tests/integration; \
	  STATUS=$$?; \
	  lsof -ti :8081 | xargs kill 2>/dev/null; \
	  lsof -ti :8082 | xargs kill 2>/dev/null; \
	  docker compose -f $(CURDIR)/docker-compose.test.yml down; \
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
