.PHONY: dev test lint docker-up docker-down backend-test frontend-test backend-lint frontend-lint compose-smoke env-dev env-prod env-status env-doctor

dev:
	./start.sh

env-dev:
	./scripts/env/switch.sh dev

env-prod:
	./scripts/env/switch.sh prod

env-status:
	./scripts/env/status.sh

env-doctor:
	./scripts/env/doctor.sh

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
