IMAGE_APP        := mvc-pwa
CONTAINER_BIN    := container
NODE_VERSION     := $(shell cat .node-version)
WORKDIR          := /app

.PHONY: start image install dev build-app test icons clean

# --------------------------------------------------
# Container daemon
# --------------------------------------------------

start: ## Start the Apple container system daemon
	$(CONTAINER_BIN) system start

# --------------------------------------------------
# Container image
# --------------------------------------------------

image: start ## Build dev container image (node:$(NODE_VERSION)-slim)
	$(CONTAINER_BIN) build -f Containerfile -t $(IMAGE_APP) --build-arg NODE_VERSION=$(NODE_VERSION) .

# --------------------------------------------------
# Compilation and serving targets
# --------------------------------------------------

install: start ## Run package installation inside container
	$(CONTAINER_BIN) run --rm -v $(shell pwd):$(WORKDIR) $(IMAGE_APP) npm install

dev: start ## Start local Vite development server inside container
	$(CONTAINER_BIN) run --rm -it -p 5173:5173 -v $(shell pwd):$(WORKDIR) --name mvc-pwa-dev $(IMAGE_APP) npm run dev

build-app: start ## Compile optimized static assets
	$(CONTAINER_BIN) run --rm -v $(shell pwd):$(WORKDIR) $(IMAGE_APP) npm run build

test: start ## Run Playwright E2E integration tests inside container
	$(CONTAINER_BIN) run --rm -v $(shell pwd):$(WORKDIR) $(IMAGE_APP) npm run test

icons: start ## Generate PWA icons from the splash design (dark bg + gradient T)
	$(CONTAINER_BIN) run --rm -v $(shell pwd):$(WORKDIR) $(IMAGE_APP) node scripts/generate-icons.mjs

clean: ## Clear compiled directories and node dependencies
	rm -rf node_modules dist .vite
