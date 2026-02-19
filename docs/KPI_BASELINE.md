# KPI Baseline (Phase 3/4)

This document defines the weekly KPI baseline for AI-assisted engineering operations.

## Core metrics

1. Intake-to-PR lead time
2. PR cycle time
3. Queue failure rate
4. Agent rework rate
5. Evidence completeness rate
6. Regression incident count

## Collection cadence

- Weekly digest issue generated automatically.
- Human reviewer validates outliers and annotates root causes.
- Metrics are compared week-over-week to detect drift.

## Operating notes

- Keep merges human-reviewed.
- Treat failed deterministic verification as a hard stop.
- Use risk labels consistently (`risk:low`, `risk:medium`, `risk:high`).

## Escaped-regression tracking (Phase 3)

Production-sensitive areas require explicit regression tracking when defects escape to production:

### High-sensitivity areas
1. **Payments**: Stripe integration, checkout flow, order confirmation
2. **Authentication**: OAuth flows, session management, token handling
3. **SEO**: Canonical URLs, meta tags, structured data, robots/sitemap
4. **Security**: Input sanitization, CORS policies, rate limiting

### Tracking workflow
1. When a regression is discovered in production:
   - Create an issue with labels: `severity:s1`, `area:<relevant>`, `regression:escaped`
   - Include root cause analysis in issue body
   - Link to the original PR that introduced the regression
   - Document detection gap (why it escaped CI/review)

2. Update KPI weekly digest with:
   - Regression incident count
   - Root cause category (missing test, insufficient review, CI gap, etc.)
   - Remediation timeline

3. For recurring patterns:
   - Update CI checks to catch the pattern
   - Add targeted tests to prevent recurrence
   - Consider adding checks to branch protection audit

### Regression categories
- `regression:ci-gap` - Would have been caught by better CI coverage
- `regression:review-miss` - Escaped during human review
- `regression:spec-drift` - Behavior changed without explicit requirement
- `regression:edge-case` - Uncommon scenario not covered by tests
