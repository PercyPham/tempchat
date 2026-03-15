.PHONY: dev dev-up dev-down \
        build build-wa build-be \
        deploy-wa deploy-site \
        test test-be \
        typecheck typecheck-wa typecheck-be \
        help

# ── Dev servers ───────────────────────────────────────────────────────────────

dev:          ## Start everything: Redis + backend (air) + webapp (vite)
	@bash scripts/dev.sh

# ── Infrastructure ────────────────────────────────────────────────────────────

dev-up:       ## Start Redis + RedisInsight via Docker Compose
	docker compose -f docker-compose.dev.yml up -d

dev-down:     ## Stop dev infrastructure
	docker compose -f docker-compose.dev.yml down

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
	@$(MAKE) test-be

test-be:      ## Run Go tests
	cd backend && go test ./...

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
