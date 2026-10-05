.PHONY: dev backend frontend fixtures test typecheck visual build app

# API on :8000 and the UI on :5173 (which proxies /api and /media to the API)
dev:
	$(MAKE) -j2 backend frontend

backend:
	cd backend && uv run fastapi dev app/main.py --port 8000

frontend:
	cd frontend && npm run dev

# the UI on sample data, no backend needed
fixtures:
	cd frontend && npm run dev:fixtures

test:
	cd backend && uv run pytest -q
	cd frontend && npm test

typecheck:
	cd frontend && npx tsc --noEmit -p .

visual:
	cd frontend && npm run test:visual

build:
	cd frontend && npm run build

# the desktop window (pywebview), serving the built UI
app: build
	cd backend && uv run python desktop.py

# Start-menu + desktop shortcuts (no console window)
shortcut: build
	pwsh -NoProfile -File install-shortcut.ps1 -StartMenu -Desktop
