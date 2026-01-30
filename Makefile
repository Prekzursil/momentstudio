.PHONY: dev test lint docker-up docker-down backend-test frontend-test backend-lint frontend-lint compose-smoke

dev:
	./start.sh

test: backend-test frontend-test

lint: backend-lint frontend-lint

backend-test:
	PYTHONPATH=backend pytest backend/tests

frontend-test:
	cd frontend && npm test -- --watch=false

backend-lint:
	cd backend && ruff check .
	cd backend && PYTHONPATH=$$(pwd) mypy app

frontend-lint:
	cd frontend && npm run lint

docker-up:
	cd infra && docker compose up --build

docker-down:
	cd infra && docker compose down

compose-smoke:
	bash scripts/compose-smoke.sh
