.PHONY: dev dev-owner test lint verify docker-up docker-down backend-test frontend-test backend-lint frontend-lint compose-smoke env-dev env-prod env-status env-doctor coverage coverage-backend coverage-frontend codacy-coverage-upload coverage-codacy

dev:
	./start.sh

dev-owner:
	./scripts/dev/dev-owner.sh

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

verify: lint test

coverage: coverage-backend coverage-frontend

backend-test:
	PYTHONPATH=backend pytest backend/tests

frontend-test:
	cd frontend && npm test -- --watch=false

coverage-backend:
	PYTHONPATH=backend coverage run --source=backend/app -m pytest backend/tests
	coverage xml -o backend/coverage.xml

coverage-frontend:
	cd frontend && npm test -- --watch=false --code-coverage --browsers=ChromeHeadlessNoSandbox || npm test -- --watch=false --code-coverage

codacy-coverage-upload:
	@if [ -z "$$CODACY_API_TOKEN" ]; then echo "CODACY_API_TOKEN is required"; exit 1; fi
	curl -Ls https://coverage.codacy.com/get.sh | bash -s -- report \
		--api-token "$$CODACY_API_TOKEN" \
		--organization-provider "$${CODACY_ORGANIZATION_PROVIDER:-gh}" \
		--username "$${CODACY_USERNAME:-Prekzursil}" \
		--project-name "$${CODACY_PROJECT_NAME:-AdrianaArt}" \
		--coverage-reports backend/coverage.xml \
		--coverage-reports frontend/coverage/app/lcov.info

coverage-codacy: coverage codacy-coverage-upload

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
