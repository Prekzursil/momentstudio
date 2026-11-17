# HOME45 select — focalPosition + isExternalHttpUrl + columnsGridClasses

## Grounding

| Field | Value |
| --- | --- |
| WU | home45 |
| Spec | `frontend/src/app/pages/home/home.component.spec.ts` |
| NEVER-TOUCH | production `home.component.ts` |
| Branch | `cursor/golden-wu-home-focal-url-columns-coverage-4739` |
| Base | `origin/main` |

## Selected slice (N=3)

1. `focalPosition` — clamp / round / default (+ NaN micro-assert)
2. `isExternalHttpUrl` — trimmed http(s) true; relative/empty/ftp/null/undefined false
3. `columnsGridClasses` — full count×breakpoint matrix (2\|3 × sm\|md\|lg) + base tokens

## Proposed `it` titles

- `focalPosition clamps, rounds, and defaults object-position percentages`
- `isExternalHttpUrl accepts trimmed http(s) and rejects non-http urls`
- `columnsGridClasses maps columns_count and breakpoint to the full grid class matrix`

## Vacuity / deslop

- Full columns matrix (6 cells), not behaviour.spec's 2/sm + 3/lg samples
- At least one trimmed/cased external URL (`HTTPS://…`) behaviour.spec lacks
- Titles live in `home.component.spec.ts` only
