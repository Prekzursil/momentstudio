# R3-payments-security — Security lens: FastAPI + Angular commerce, payment + authz

Method: read-only source review of the payment, auth and authz surface against OWASP ASVS 5.0,
OWASP API Security Top-10 2023, RFC 9700 (OAuth 2.0 Security BCP), and the Stripe/PayPal webhook
integration docs. Findings marked CONFIRMED are provable by reading the cited lines; exploit
*impact* estimates carry a confidence band. No exploitation was performed against any third party.

---

## P1 — Auth rate limiters are GLOBAL, not per-identifier → whole-site login DoS
**Confidence: almost-certain (90-99%) — CONFIRMED by code.**
`limiter()` buckets on a single constant identifier (`identifier="global"`, and in-memory
`buckets[key]` is one deque per key), unlike `per_identifier_limiter()`. `/auth/login`,
`/auth/refresh`, `/auth/2fa`, `/auth/step-up`, `/auth/password-reset/*` all use `limiter()`.
Impact: one unauthenticated client sending 20 requests/min to `POST /api/v1/auth/login` exhausts the
*shared* budget and every other user gets 429 — a ~1 req/3s DoS on all authentication.
Fix: convert these to `per_identifier_limiter(_user_or_ip_identifier, …)` and add a *separate*
per-account counter (the existing `user.locked_until` path) so per-IP and per-account limits compose.
Do not raise the ceiling — that trades the DoS for a brute-force window.

## P1 — HttpOnly refresh cookie is negated: the refresh token is also returned in the JSON body
**Confidence: almost-certain — CONFIRMED.** `TokenPair(access_token=…, refresh_token=…)` is returned
by `/auth/refresh` (auth.py:1279, 1293, 1317) and by login; the Angular client requires it
(`isAuthResponse` asserts `tokens.refresh_token`). The access token is correctly memory-only
(auth.service.ts:805-828 clears storage), so the *only* thing HttpOnly was buying is defeated: any
XSS reads a 7-day refresh token straight out of the login/refresh response.
Fix: stop emitting `refresh_token` in the body when the cookie is set (keep the field for the
non-browser/native path behind an explicit `client_type` flag); drop `refresh_token` from
`AuthTokens` in the Angular client. ASVS V3.5/V50.

## P1 — Admin IP allowlist is skipped on the money-moving endpoints
**Confidence: almost-certain — CONFIRMED.** `require_admin_section()` calls
`_require_admin_ip_access()`; `require_admin()` and `require_owner()` do **not**. 39 endpoints use
`require_admin`, including `POST /orders/admin/{id}/refund` (3351), `/refunds` (3416),
`/capture-payment` (4039), `/void-payment` (4089) and the maintenance-mode toggle. An operator who
sets `ADMIN_IP_ALLOWLIST` reasonably believes refunds are IP-fenced; they are not.
Fix: move `_require_admin_ip_access(request, user)` into `require_admin`/`require_owner` (or a
single shared `_admin_guards()` helper) so all three paths are identical.

## P1 — `SENTRY_SEND_DEFAULT_PII=True` by default, and Sentry is mandatory in production
**Confidence: likely (55-80%) for the credential-leak half; almost-certain that PII ships.**
`sentry_send_default_pii: bool = True` (config.py:210), `init_sentry()` sets no `before_send` and no
custom `EventScrubber`, and `validate_production_settings()` *requires* a DSN in prod
(startup_checks.py:48). Sentry's documented behaviour is that `send_default_pii=True` attaches user
IP, request headers **including `Cookie`**, and request bodies. That would put a live `refresh_token`
cookie in a third-party SaaS. UNVERIFIED (inline): whether sentry-sdk's default `EventScrubber` still
strips the `Cookie` header when `send_default_pii=True` — settling experiment: point the DSN at a
local sink (`sentry-cli`/`nc`), trigger a 500 on an authenticated request, and inspect the envelope
JSON for `request.cookies`. Fix regardless: default the setting to `False` and add an explicit
`before_send` denylist (`cookie`, `authorization`, `line1`, `line2`, `phone`).

## P1 — Audit log writes unredacted checkout PII (street address, full name, DOB, VAT)
**Confidence: almost-certain — CONFIRMED.** `audit_log_request_payload=True` by default;
`_is_sensitive_key` matches only the exact keys / fragments at middleware/security.py:15-52. The
guest-checkout body (`schemas/checkout.py:29-72`) carries `name`, `line1`, `line2`, `region`,
`date_of_birth`, `invoice_company`, `invoice_vat_id`, `customer_email` — **none** of which match a
fragment (`address`/`street`/`city`/`postal` do not appear in `line1`). Every guest checkout writes a
full postal address + legal name + DOB to the application log. GDPR data-minimisation / ASVS V7.1.1.
Fix: invert to an allowlist (log only a fixed set of non-PII keys), or add the missing fragments
(`line`, `name`, `birth`, `vat`, `company`, `region`, `email`, `iban`, `card`).

## P2 — Ownership guard on `/orders/stripe/confirm` and `/orders/paypal/capture` is a no-op
**Confidence: almost-certain — CONFIRMED.** Line 1327 already 400s when
`payload.order_id and order.id != payload.order_id`; the guard at 1333-1342 (and 1153-1162 for
PayPal) then reaches `elif payload.order_id and order.id == payload.order_id: pass`, which is
tautologically true whenever `order_id` is supplied. The comment "keep confirmation bound to the same
user" is false — knowledge of the two identifiers is the only authorization. Impact is bounded
(identifiers are unguessable), but this is OWASP API1:2023 BOLA by construction.
Fix: require `current_user.id == order.user_id` for user-bound orders, and gate the guest path on the
guest-email verification token instead of on `order_id` echo.

## P2 — No amount/currency assertion anywhere on the fulfilment path
**Confidence: almost-certain that the check is absent; likely that it is currently unexploitable.**
`process_stripe_event` fulfils on `payment_status == "paid"` alone; `payment_intent.succeeded` and
PayPal `CHECKOUT.ORDER.APPROVED` fulfil with no comparison; `confirm_stripe_checkout` retrieves the
session and checks only `payment_status`. Stripe's integration guidance is to verify
`amount_total`/`currency` against your own record before granting value. Amounts are set server-side
today, so I found no live underpayment path — that is a hypothesis, not an observation. Fix (cheap,
defence-in-depth): assert `amount_total == _money_to_cents(order.total_amount)` and
`currency == "ron"` (PayPal: `purchase_units[0].amount`) before writing `payment_captured`.

## P2 — No refresh-token reuse detection (no family revocation)
**Confidence: almost-certain — CONFIRMED.** Presenting an already-rotated token outside the 60 s
grace raises 401 (auth.py:1281) but does not revoke the replacement chain. RFC 9700 §4.14.2 requires
that a detected replay invalidate the whole session family, because a 401 alone leaves the thief's
stolen-but-valid successor working. Fix: on `stored.revoked and reason == "rotated"` outside grace,
walk `replaced_by_jti` and revoke the descendants with reason `reuse_detected`, plus a security event.

## P2 — Rate-limit identifier is client-chosen, and the in-memory bucket map never evicts
**Confidence: almost-certain — CONFIRMED.** `_user_or_session_or_ip_identifier` (payments.py:50-60,
mirrored in orders.py:140) prefers the attacker-supplied `X-Session-Id` header over the IP, so
rotating that header resets the checkout/payment-intent limit. Separately,
`buckets: DefaultDict[Hashable, deque]` (rate_limit.py:121) has no TTL or size cap → unbounded
memory growth keyed by attacker input. With `redis_url` unset (the default) limits are also
per-process, so N uvicorn workers multiply every ceiling by N.
Fix: always include the IP in the identifier tuple; cap/evict the bucket map (LRU + periodic sweep);
require Redis in production via `validate_production_settings`.

## P2 — CSRF has no defence-in-depth behind SameSite
**Confidence: likely.** The refresh cookie is `HttpOnly; SameSite=lax; Path=/`, and the Angular
interceptor sends `withCredentials: true` on *every* API call (http.interceptor.ts:94). Cookie-bearing
state-changing endpoints (`POST /auth/refresh`, `POST /auth/logout`) have no CSRF token, no
`Origin`/`Sec-Fetch-Site` check, and no `__Host-` cookie prefix. Today Lax blocks the cross-site POST,
so this is not exploitable as configured — but `COOKIE_SAMESITE=none` is a supported setting
(startup_checks.py:54 only pairs it with Secure), and flipping it silently opens forced-logout /
session-rotation CSRF. Fix: reject cookie-authenticated POSTs whose `Origin` is not in
`cors_origins`; rename the cookie to `__Host-refresh_token` (implies Secure + Path=/ + no Domain).

## P2 — Netopia IPN acknowledges internal failures as *permanent* errors
**Confidence: almost-certain — CONFIRMED.** payments.py:561-569 returns HTTP 200 with
`errorType: 2` on any unhandled exception, i.e. "do not retry". A transient DB error therefore
silently loses a paid-order confirmation. Unlike Stripe/PayPal there is also no persisted
`NetopiaWebhookEvent` idempotency row, and `netopia_ipn_max_age_seconds` defaults to **86400 s**, so a
captured IPN is replayable for 24 h (bounded only by the `payment_captured` event check).
Fix: return `errorType: 1` (temporary) or a 5xx on internal errors; persist the `ntpID`/`iat` as a
replay nonce; cut the max age to ~15 min.

## P3 — The SSR report-only CSP is inert
**Confidence: almost-certain — CONFIRMED.** `buildCspReportOnly` (theme-head.ts:96-104) emits only
`style-src`/`base-uri`/`object-src`/`frame-ancestors` — no `default-src`, no `script-src` — and no
`report-uri`/`report-to`, so nothing is collected and no script surface is covered. The enforcing
policy exists only in `infra/prod/Caddyfile:53`; any deployment not fronted by that Caddy (dev,
staging, the SSR container directly) ships **no** enforcing CSP and no `X-Frame-Options`. Note the
Caddy policy's `style-src 'unsafe-inline'` also makes the SSR per-response style hash pointless.
Fix: add `default-src 'self'; script-src 'self' …` + a `report-to` endpoint to the report-only header,
then flip to enforce; drop `'unsafe-inline'` from `style-src` once the theme hash is honoured.

## P3 — Two smaller authz weaknesses
**Confidence: almost-certain — CONFIRMED.** (a) `_admin_ip_bypass_active` compares the bypass secret
with `==` (dependencies.py:118) — use `hmac.compare_digest`. (b) `_extract_admin_client_ip` takes the
*leftmost* `X-Forwarded-For` value (dependencies.py:107-109) with no trusted-proxy count, so when
`ADMIN_IP_HEADER=x-forwarded-for` the allowlist is bypassable by header spoofing — take the
Nth-from-right hop instead.

## P3 — PayPal signature verification re-serializes the event
`verify_webhook_signature` posts the parsed `event` dict (paypal.py:570) rather than the raw body.
It fails closed, so this is a reliability risk (spurious 400s on key-order/whitespace differences),
not a bypass. Prefer passing the raw body through unchanged.

---

## Prioritized verification list (checklist item → exact place to check)

| # | Checklist item (source standard) | Where to verify | Status found |
|---|---|---|---|
| 1 | Webhook signature verification | `services/payments.py:364-381` (Stripe), `services/paypal.py:535-590`, `services/netopia.py:424-490` | PASS — all three verify |
| 2 | Webhook replay window | Stripe SDK 300 s tolerance; PayPal API-side; Netopia `netopia_ipn_max_age_seconds` | Netopia 24 h — FIX |
| 3 | Webhook idempotency (event-id uniqueness) | `models/webhook.py`, `api/v1/payments.py:157-308` | PASS for Stripe/PayPal; Netopia MISSING |
| 4 | Order-creation idempotency | `api/v1/orders.py:630-726` (`Cart.last_order_id` + `with_for_update`) | PASS on Postgres (`FOR UPDATE` is a no-op on SQLite) |
| 5 | Server-side price recomputation | `services/cart.py::calculate_totals_async`, `orders.py:889-899`, `payments.py:258-285` line-item total assertion | PASS — client never supplies amounts |
| 6 | Amount/currency verified before fulfilment | `services/webhook_handlers.py:60-299`, `orders.py:1265-1437` | MISSING — see P2 |
| 7 | Authz on every admin endpoint (BOLA) | `core/dependencies.py:345-400`; 39 `require_admin` vs 292 `require_admin_section` call sites | INCONSISTENT — see P1 |
| 8 | Ownership binding on confirm/capture | `orders.py:1142-1162`, `1327-1342` | NO-OP guard — see P2 |
| 9 | Session/refresh split | `api/v1/auth.py:213-234`, `1141-1317`; `frontend/src/app/core/auth.service.ts:805-828` | Access-token-in-memory is GOOD; refresh-in-body defeats it |
| 10 | Refresh reuse detection | `auth.py:1241-1283` | MISSING |
| 11 | CSRF posture for cookie refresh | `auth.py:213-234`, `frontend/src/app/core/http.interceptor.ts:94` | SameSite-only — see P2 |
| 12 | Rate limiting on auth + checkout | `core/rate_limit.py:78-137`; `auth.py:100-137`; `payments.py:50-68`; `orders.py:140` | GLOBAL bucket + client-chosen key — see P1/P2 |
| 13 | PII in logs/errors | `middleware/security.py:15-141`, `core/sentry.py:35-45` | LEAKING — see P1 |
| 14 | Secure headers / CSP | `middleware/security.py:144-158`, `infra/prod/Caddyfile:45-54`, `frontend/src/server.ts:79` | Enforcing only behind Caddy; report-only header inert |
| 15 | Prod config fail-fast | `core/startup_checks.py:18-109` | Good coverage; add `REDIS_URL`, `SENTRY_SEND_DEFAULT_PII=0`, `CORS_ORIGINS != ["*"]` |

Not re-reported (already known this session): Alembic Postgres-only chain, dev-compose SSR,
SSR `allowedHosts`, `/sitemap.xml` origin split.

---

## EVIDENCE

1. `backend/app/core/rate_limit.py:91-101` — `_enforce_limit_redis(key=key, identifier="global", …)`
   then `_enforce_limit(buckets[key], …)`; vs `per_identifier_limiter` at `:123-134`. Call sites:
   `backend/app/api/v1/auth.py:106-114`.
2. `backend/app/api/v1/auth.py:1317` `return TokenPair(access_token=access, refresh_token=refresh)`
   together with `set_refresh_cookie(...)` at `:1316`; client contract at
   `frontend/src/app/core/auth.service.ts:814-818`.
3. `backend/app/core/dependencies.py:345-356` (`require_admin`, no `_require_admin_ip_access`) vs
   `:367-386` (`require_admin_section`, has it); money endpoints at
   `backend/app/api/v1/orders.py:3351, 3416, 4039, 4089`.
4. `backend/app/api/v1/orders.py:1333-1342` — `elif payload.order_id and order.id == payload.order_id:
   pass`, unreachable-as-deny because `:1327-1330` already rejected the mismatch case.
5. `backend/app/core/config.py:210` `sentry_send_default_pii: bool = True`;
   `backend/app/core/sentry.py:35-45` (no `before_send`, no `event_scrubber`);
   `backend/app/core/startup_checks.py:48-49` (DSN required in prod).
6. `backend/app/middleware/security.py:15-52` redaction sets vs
   `backend/app/schemas/checkout.py:45-59` (`line1`, `line2`, `region`, `date_of_birth`,
   `invoice_company`, `invoice_vat_id`).
7. External: OWASP API Security Top 10 2023 — API1 BOLA, API4 Unrestricted Resource Consumption
   (https://owasp.org/API-Security/editions/2023/en/0x11-t10/); OWASP ASVS 5.0 V3 (Session Mgmt) /
   V7 (Logging) (https://owasp.org/www-project-application-security-verification-standard/);
   RFC 9700 §4.14 Refresh Token Protection (https://www.rfc-editor.org/rfc/rfc9700.html);
   Stripe "Verify webhook signatures / check the amount before fulfilling"
   (https://docs.stripe.com/webhooks#verify-events, https://docs.stripe.com/checkout/fulfillment);
   PayPal webhook signature verification
   (https://developer.paypal.com/api/rest/webhooks/rest/); MDN `__Host-` cookie prefix
   (https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes).

SUCCESS:R3-payments-security 14 findings (5×P1, 6×P2, 3×P3); headline: global auth rate limiter = whole-site login DoS, refresh token echoed in JSON body defeats HttpOnly, admin IP allowlist skipped on refund/capture/void.
