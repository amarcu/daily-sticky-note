# Daily Sticky Note - convenience targets. Run `make` (or `make help`) for the list.
.DEFAULT_GOAL := help
PORT ?= 4599

# Installs the Tauri CLI only when it's missing or package.json changed.
node_modules: package.json
	npm install
	@touch node_modules

.PHONY: dev
dev: node_modules ## Run the desktop app (installs deps first if needed)
	npm run dev

.PHONY: build
build: node_modules ## Build a desktop installer into src-tauri/target/release/bundle
	npm run build

.PHONY: web
web: ## Serve the web version at http://localhost:$(PORT)
	@echo "Web app at http://localhost:$(PORT)  (Ctrl+C to stop)"
	@cd docs && python3 -m http.server $(PORT)

.PHONY: icons
icons: node_modules ## Regenerate app icons from build/icon.png
	npm run icon

.PHONY: help
help:
	@echo "Daily Sticky Note - available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-7s\033[0m %s\n", $$1, $$2}'
