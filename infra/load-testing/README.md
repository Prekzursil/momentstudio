# Load Testing Plan

This folder contains quick smoke and load scripts to exercise the API with k6 and Locust.

## k6

Requirements: `k6` installed locally.

Run a short smoke:

```bash
k6 run k6-smoke.js
```

Environment variables:

- `BASE_URL` (default `http://localhost:8000`)
- `VU` (virtual users, default 10)
- `DURATION` (default `30s`)

## Locust

Requirements: `locust` (`pip install locust`).

Start a simple scenario:

```bash
locust -f locustfile.py --host=http://localhost:8000
```

Scenarios hit `/api/v1/health` and `/api/v1/catalog/products` with basic filters to observe latency/error rates.

Tuning parameters:

- `--users`, `--spawn-rate` to scale load.
- Use Locust UI to ramp traffic and view charts.
