# S1-authz-matrix — Backend authorization matrix (FastAPI): every admin/user endpoint

AST enumeration of all 30 modules in `backend/app/api/v1/` → **468 route decorators** (router-level,
decorator, and signature `Depends(...)` all resolved), each guard mapped to its role set via
`app/core/dependencies.py:26-52`. Paths = `/api/v1` + router prefix (`main.py:89`, `routes.py:44-71`).
**Guard summary §A · full 468-row matrix §B.** Top claims executed against `http://localhost:4202`.
(An earlier run of this lane wrote here at 14:36; this pass re-derived independently — same 468
count. Finding 3 corroborates it; 1, 2, 4, 5, 6 are additive.)

## Clean results (checked, not padded)

- **Criterion (1) — no defect.** All 24 unauthenticated `POST/PUT/PATCH/DELETE` routes are
  deliberately pre-auth and carry their own credential: 3 provider-signed webhooks
  (`payments.py:157,200,311`), the auth/newsletter/guest-checkout pre-login set, and
  `DELETE /auth/admin/ip-bypass` (clears only the caller's cookie, `auth.py:1380`). Unauthenticated
  probes of 9 admin endpoints all returned 401/403.
- **Criterion (3) — IDOR/BOLA: none found.** Every owner-scoped id path re-checks ownership:
  `orders.py:4157,4170,4295-4302,4341-4348,4390`, `addresses.py:38,52`, `support.py:239,256`,
  `services/blog.py:841-845`, `services/cart.py:619`, `auth.py:1125`; `services/notifications.py`
  queries are all `user_id`-scoped.

---

## P1 — Login/2FA/refresh/reset rate limits share ONE GLOBAL bucket; any client locks out every user (CONFIRMED, executed · almost-certain 90-99%)

`limiter()` hardcodes `identifier="global"` (`core/rate_limit.py:95`) — one bucket per deployment.
`auth.py:106-115` uses it for `/auth/login`, `/login/2fa`, `/refresh`, `/step-up`,
`/password-reset/request`, `/password-reset/confirm`. Its sibling `per_identifier_limiter()` (per
IP/user) *is* used for register, google, verify, checkout, guest-checkout, payment-intent, contact,
newsletter, analytics — so this is an inconsistency in the same file, not a design stance.

**Impact.** `auth_rate_limit_login = 20`/60s (`config.py:180`) site-wide: one unauthenticated client
sending 21 bad logins/min denies login to every customer *and* every admin, free and indefinitely.
`/auth/refresh` (60/min global) is worse in effect — exhausting it logs the whole active user base
out as access tokens expire. It is also the wrong control: distributed credential stuffing is
throttled no harder than one host, and there is no per-account lockout signal at all.

**Repro (executed).** 22 × bad `POST /auth/login` → `401`×21 then `429`; immediately after, a valid
owner login → `429`, and a valid unrelated customer login → `429`.

**Fix.** Swap all six buckets to `per_identifier_limiter(lambda r: r.client.host …)` (as
`auth.py:100-105` already does), plus a second bucket keyed on `payload.email`; keep a global bucket
only as a far higher circuit-breaker ceiling.

## P1 — `support` can lock out and force-reset `admin` accounts (CONFIRMED, executed · almost-certain 90-99%)

`PATCH /api/v1/admin/dashboard/users/{user_id}/security` (`admin_dashboard.py:4540`) is guarded by
`require_admin_section("users")`, which admits `support` (`dependencies.py:49`). The handler blocks
an `owner` target (`:4553-4557`) and self (`:4558-4562`) — but **not `admin`**. `support` is the
junior staff tier everywhere else (excluded from `audit` and `ops`, `dependencies.py:41,51`).

**Impact.** Privilege inversion: a compromised support account sets `locked_until` far in the future
on every admin plus `password_reset_required=true`, locking the platform's administrators out of
their own console. Pairs with `POST /users/{user_id}/password-reset/resend` (`:4736`, same section,
also no target-role guard) to push reset mail at owner/admin addresses.

**Repro (executed).** `support` bearer → PATCH an `admin` target with
`{"locked_until":"2027-01-01T00:00:00Z","password_reset_required":true}` → **200**; that admin's
next login → **403 "Account temporarily locked"**. Same call vs the owner → **400** (control).

**Fix.** Reject when `user.role in (owner, admin)` unless the actor outranks the target; same rank
check on `resend_password_reset` and `resend_email_verification`; put the helper in
`dependencies.py` so the rule is stated once.

## P1 — `require_admin` / `require_owner` skip the admin IP allow/denylist that `require_admin_section` enforces (CONFIRMED by code · almost-certain 90-99%)

`_require_admin_ip_access` has exactly **one** call site: inside `require_admin_section._dep`
(`dependencies.py:382`). `require_admin` (`:345-356`) and `require_owner` (`:389-400`) run MFA and
the training-mode check but **not** the IP check. The allow/denylist therefore covers 271 routes and
is silently absent on **34**.

**Impact.** The exempted set is the dangerous slice: `GET /admin/dashboard/export` (whole-DB JSON),
`PATCH /admin/dashboard/users/{id}/role`, `POST /admin/dashboard/owner/transfer`, `GET
/admin/dashboard/gdpr/exports/{id}/download`, `POST /orders/admin/{id}/refund|refunds|capture-payment|
void-payment`, `POST /admin/dashboard/maintenance`, every `/taxes/admin/*` + `/fx/admin/*` write. An
operator who sets `ADMIN_IP_ALLOWLIST` believes admin is network-fenced; it is not.

**Repro.** Static and unbranching: one definition (`:130`), one call (`:382`). Not executed live —
the running instance has no allowlist and I will not restart a shared service.

**Fix.** Hoist MFA + IP + training-mode into one `_admin_gate()` called by all three dependencies;
test that every `require_admin*`/`require_owner` dependency denies a denylisted IP.

## P2 — `/admin/dashboard/{users,orders,summary,search,funnel,…}` admit `content` and `fulfillment`, unlike every sibling (CONFIRMED, executed · almost-certain 90-99%)

Section `dashboard` admits all five staff roles (`dependencies.py:34-40`); 16 routes use it,
including `GET /admin/dashboard/users` (`:2545`) and `/orders` (`:2511`) — while every sibling on
the same resource is narrower: `/users/search`, `/users/{id}/profile`, `/users/{id}/aliases` →
`users`; all 41 `/orders/admin/*` → `orders`.

**Impact (bounded).** PII *is* masked for these roles (`services/pii.py:17-38`) — hence P2, not P1.
Still leaked to a content editor: the full **username + role** list (enumerate every admin/owner
account for targeted phishing; usernames are not masked, `:2563`), order values, and the
revenue/funnel/channel/refund analytics.

**Repro (executed).** `content` bearer: **200** on `/users`, `/orders`, `/summary`, `/search`,
`/funnel`, `/channel-breakdown`, `/refunds-breakdown`; **403** on `/users/search`, `/orders/admin`,
`/admin/dashboard/export`.

**Fix.** Re-key `admin_users` → section `users`, `admin_orders` → section `orders`; reserve
`dashboard` for genuinely cross-role widgets; mask `username`/drop `role` for non-`PII_REVEAL_ROLES`.

## P2 — Shared secrets compared with `==`/`!=` instead of `hmac.compare_digest` (CONFIRMED by code · exploitability likely 55-80%)

`dependencies.py:118` (admin IP-bypass secret), `content.py:2343` (`CONTENT_PREVIEW_TOKEN`),
`middleware/backpressure.py:87` (`MAINTENANCE_BYPASS_TOKEN`) — all non-constant-time, while
`services/media_dam.py:485` does it correctly. Remote timing recovery over a noisy network is hard
(hence the band), but these are long-lived static secrets with unlimited unrated attempts and the fix
is one import. `orders.py:2297` is the same pattern but attempt-capped (`:2291-2296`) → P3.
**Fix:** `hmac.compare_digest` at all four sites.

## P2 — The repo's own edge config *appends* to `X-Forwarded-For`, defeating the admin IP allowlist it documents (CONFIRMED by code · almost-certain 90-99%)

`_extract_admin_client_ip` special-cases `x-forwarded-for` and takes `raw.split(",", 1)[0]`
(`dependencies.py:107-109`) — the left-most, client-supplied entry. `docs/PRODUCTION.md:167` tells
operators to "ensure your proxy strips spoofed headers", but the shipped `infra/ssr-edge.conf:19`
uses `$proxy_add_x_forwarded_for`, which *appends* `$remote_addr` and leaves the attacker's value
first. With `ADMIN_IP_HEADER=x-forwarded-for` + an allowlist, any client passes by sending
`X-Forwarded-For: <allowlisted-ip>`. R3 flagged header-trust generally
(`R3-payments-security.md:132`); the additive point is that the repo's own nginx config makes that
"misconfiguration" the default. **Fix:** `proxy_set_header X-Forwarded-For $remote_addr;` on the
`/api/v1/` location, and read the right-most untrusted hop, not `[0]`. Prod's
`--forwarded-allow-ips` (`infra/prod/docker-compose.yml:92-93`) only sanitises
`request.client.host`, which this function bypasses.

## P3 — `require_staff` is dead code

`dependencies.py:359-364` (and `_STAFF_ROLES`, `:26-32`) is used by **0 of 468** routes. Delete it,
or adopt it for the `dashboard` widgets that genuinely are all-staff.

---

## §A — Guard summary

| Guard | Roles admitted | Routes |
| --- | --- | ---: |
| `require_admin_section('content')` | owner, admin, content | 72 |
| `(no auth dependency)` | public | 55 |
| `get_current_user` | any authenticated | 53 |
| `require_admin_section('products')` | owner, admin, content | 45 |
| `require_admin_section('orders')` | owner, admin, fulfillment | 34 |
| `require_admin` | owner, admin | 32 |
| `require_admin_section('coupons')` | owner, admin, content | 27 |
| `get_current_user_optional` | public (identity used if present) | 26 |
| `require_complete_profile` | any authenticated + complete profile | 23 |
| `require_admin_section('ops')` | owner, admin | 20 |
| `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | 16 |
| `require_admin_section('users')` | owner, admin, support | 16 |
| `require_admin_section('inventory')` | owner, admin, fulfillment | 10 |
| `require_admin_section('support')` | owner, admin, support | 10 |
| `require_admin_section('returns')` | owner, admin, fulfillment | 8 |
| `require_admin_section('theme')` | owner, admin, content | 8 |
| `require_admin_section('audit')` | owner, admin | 5 |
| `require_verified_email` | any authenticated + verified email | 5 |
| `require_owner` | owner | 2 |
| `get_google_completion_user` | google-completion token holder | 1 |
| **TOTAL** | | **468** |

Section role sets are defined once in `app/core/dependencies.py:33-52`. `require_admin_section`
additionally enforces admin-MFA, the admin IP allow/denylist, and training-mode read-only
(`:376-384`); `require_admin`/`require_owner` enforce MFA + training-mode only (see P1 #3).

## §B — Full route matrix (468 rows)

| Method | Path | Guard dependency | Roles admitted | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/dashboard/alert-thresholds` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `admin_dashboard.py:232` |
| PUT | `/api/v1/admin/dashboard/alert-thresholds` | `require_owner` | owner | `admin_dashboard.py:243` |
| GET | `/api/v1/admin/dashboard/audit` | `require_admin_section('audit')` | owner, admin | `admin_dashboard.py:3294` |
| GET | `/api/v1/admin/dashboard/audit/entries` | `require_admin_section('audit')` | owner, admin | `admin_dashboard.py:3537` |
| GET | `/api/v1/admin/dashboard/audit/export.csv` | `require_admin_section('audit')` | owner, admin | `admin_dashboard.py:3594` |
| GET | `/api/v1/admin/dashboard/audit/retention` | `require_admin_section('audit')` | owner, admin | `admin_dashboard.py:3709` |
| POST | `/api/v1/admin/dashboard/audit/retention/purge` | `require_admin_section('audit')` | owner, admin | `admin_dashboard.py:3739` |
| GET | `/api/v1/admin/dashboard/channel-attribution` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `admin_dashboard.py:1799` |
| GET | `/api/v1/admin/dashboard/channel-breakdown` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `admin_dashboard.py:920` |
| GET | `/api/v1/admin/dashboard/content` | `require_admin_section('content')` | owner, admin, content | `admin_dashboard.py:3006` |
| GET | `/api/v1/admin/dashboard/coupons` | `require_admin_section('coupons')` | owner, admin, content | `admin_dashboard.py:3060` |
| POST | `/api/v1/admin/dashboard/coupons` | `require_admin_section('coupons')` | owner, admin, content | `admin_dashboard.py:3191` |
| PATCH | `/api/v1/admin/dashboard/coupons/{coupon_id}` | `require_admin_section('coupons')` | owner, admin, content | `admin_dashboard.py:3236` |
| POST | `/api/v1/admin/dashboard/coupons/{coupon_id}/stripe/invalidate` | `require_admin_section('coupons')` | owner, admin, content | `admin_dashboard.py:3175` |
| GET | `/api/v1/admin/dashboard/export` | `require_admin` | owner, admin | `admin_dashboard.py:5009` |
| GET | `/api/v1/admin/dashboard/funnel` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `admin_dashboard.py:847` |
| GET | `/api/v1/admin/dashboard/gdpr/deletions` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:4203` |
| POST | `/api/v1/admin/dashboard/gdpr/deletions/{user_id}/cancel` | `require_admin` | owner, admin | `admin_dashboard.py:4351` |
| POST | `/api/v1/admin/dashboard/gdpr/deletions/{user_id}/execute` | `require_admin` | owner, admin | `admin_dashboard.py:4294` |
| GET | `/api/v1/admin/dashboard/gdpr/exports` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:3945` |
| GET | `/api/v1/admin/dashboard/gdpr/exports/{job_id}/download` | `require_admin` | owner, admin | `admin_dashboard.py:4138` |
| POST | `/api/v1/admin/dashboard/gdpr/exports/{job_id}/retry` | `require_admin` | owner, admin | `admin_dashboard.py:4053` |
| GET | `/api/v1/admin/dashboard/inventory/reservations/carts` | `require_admin_section('inventory')` | owner, admin, fulfillment | `admin_dashboard.py:5199` |
| GET | `/api/v1/admin/dashboard/inventory/reservations/orders` | `require_admin_section('inventory')` | owner, admin, fulfillment | `admin_dashboard.py:5251` |
| GET | `/api/v1/admin/dashboard/inventory/restock-list` | `require_admin_section('inventory')` | owner, admin, fulfillment | `admin_dashboard.py:5179` |
| GET | `/api/v1/admin/dashboard/inventory/restock-list/export` | `require_admin_section('inventory')` | owner, admin, fulfillment | `admin_dashboard.py:5316` |
| PUT | `/api/v1/admin/dashboard/inventory/restock-notes` | `require_admin_section('inventory')` | owner, admin, fulfillment | `admin_dashboard.py:5305` |
| GET | `/api/v1/admin/dashboard/low-stock` | `require_admin_section('inventory')` | owner, admin, fulfillment | `admin_dashboard.py:5019` |
| GET | `/api/v1/admin/dashboard/maintenance` | `require_admin` | owner, admin | `admin_dashboard.py:4997` |
| POST | `/api/v1/admin/dashboard/maintenance` | `require_admin` | owner, admin | `admin_dashboard.py:5002` |
| GET | `/api/v1/admin/dashboard/orders` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `admin_dashboard.py:2511` |
| POST | `/api/v1/admin/dashboard/owner/transfer` | `require_owner` | owner | `admin_dashboard.py:4931` |
| GET | `/api/v1/admin/dashboard/payments-health` | `require_admin_section('ops')` | owner, admin | `admin_dashboard.py:1043` |
| GET | `/api/v1/admin/dashboard/products` | `require_admin_section('products')` | owner, admin, content | `admin_dashboard.py:2155` |
| POST | `/api/v1/admin/dashboard/products/by-ids` | `require_admin_section('products')` | owner, admin, content | `admin_dashboard.py:2464` |
| GET | `/api/v1/admin/dashboard/products/duplicate-check` | `require_admin_section('products')` | owner, admin, content | `admin_dashboard.py:2345` |
| GET | `/api/v1/admin/dashboard/products/search` | `require_admin_section('products')` | owner, admin, content | `admin_dashboard.py:2184` |
| POST | `/api/v1/admin/dashboard/products/{product_id}/restore` | `require_admin_section('products')` | owner, admin, content | `admin_dashboard.py:2299` |
| GET | `/api/v1/admin/dashboard/refunds-breakdown` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `admin_dashboard.py:1233` |
| POST | `/api/v1/admin/dashboard/reports/send` | `require_admin` | owner, admin | `admin_dashboard.py:780` |
| GET | `/api/v1/admin/dashboard/scheduled-tasks` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `admin_dashboard.py:3087` |
| GET | `/api/v1/admin/dashboard/search` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `admin_dashboard.py:1985` |
| GET | `/api/v1/admin/dashboard/sessions/{user_id}` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:3850` |
| POST | `/api/v1/admin/dashboard/sessions/{user_id}/revoke` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:3812` |
| POST | `/api/v1/admin/dashboard/sessions/{user_id}/{session_id}/revoke` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:3903` |
| GET | `/api/v1/admin/dashboard/shipping-performance` | `require_admin_section('orders')` | owner, admin, fulfillment | `admin_dashboard.py:1490` |
| GET | `/api/v1/admin/dashboard/stock-adjustments` | `require_admin_section('inventory')` | owner, admin, fulfillment | `admin_dashboard.py:5059` |
| POST | `/api/v1/admin/dashboard/stock-adjustments` | `require_admin_section('inventory')` | owner, admin, fulfillment | `admin_dashboard.py:5163` |
| GET | `/api/v1/admin/dashboard/stock-adjustments/export` | `require_admin_section('inventory')` | owner, admin, fulfillment | `admin_dashboard.py:5073` |
| GET | `/api/v1/admin/dashboard/stockout-impact` | `require_admin_section('inventory')` | owner, admin, fulfillment | `admin_dashboard.py:1675` |
| GET | `/api/v1/admin/dashboard/summary` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `admin_dashboard.py:290` |
| GET | `/api/v1/admin/dashboard/users` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `admin_dashboard.py:2545` |
| GET | `/api/v1/admin/dashboard/users/search` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:2574` |
| GET | `/api/v1/admin/dashboard/users/segments/high-aov` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:2747` |
| GET | `/api/v1/admin/dashboard/users/segments/repeat-buyers` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:2658` |
| GET | `/api/v1/admin/dashboard/users/{user_id}/aliases` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:2839` |
| GET | `/api/v1/admin/dashboard/users/{user_id}/email/verification` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:4654` |
| POST | `/api/v1/admin/dashboard/users/{user_id}/email/verification/override` | `require_admin` | owner, admin | `admin_dashboard.py:4810` |
| POST | `/api/v1/admin/dashboard/users/{user_id}/email/verification/resend` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:4693` |
| POST | `/api/v1/admin/dashboard/users/{user_id}/impersonate` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:4885` |
| PATCH | `/api/v1/admin/dashboard/users/{user_id}/internal` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:4472` |
| POST | `/api/v1/admin/dashboard/users/{user_id}/password-reset/resend` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:4736` |
| GET | `/api/v1/admin/dashboard/users/{user_id}/profile` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:2882` |
| PATCH | `/api/v1/admin/dashboard/users/{user_id}/role` | `require_admin` | owner, admin | `admin_dashboard.py:4404` |
| PATCH | `/api/v1/admin/dashboard/users/{user_id}/security` | `require_admin_section('users')` | owner, admin, support | `admin_dashboard.py:4540` |
| POST | `/api/v1/admin/observability/client-errors` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `observability.py:14` |
| POST | `/api/v1/admin/shipping/sameday-sync/run` | `require_admin_section('ops')` | owner, admin | `shipping_admin.py:86` |
| GET | `/api/v1/admin/shipping/sameday-sync/runs` | `require_admin_section('ops')` | owner, admin | `shipping_admin.py:70` |
| GET | `/api/v1/admin/shipping/sameday-sync/status` | `require_admin_section('ops')` | owner, admin | `shipping_admin.py:47` |
| GET | `/api/v1/admin/ui/favorites` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `admin_ui.py:38` |
| PUT | `/api/v1/admin/ui/favorites` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `admin_ui.py:47` |
| POST | `/api/v1/analytics/events` | `get_current_user_optional` | public (identity used if present) | `analytics.py:98` |
| POST | `/api/v1/analytics/token` | `(none)` | public | `analytics.py:73` |
| GET | `/api/v1/auth/admin/access` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `auth.py:1391` |
| POST | `/api/v1/auth/admin/cleanup/incomplete-google` | `require_admin` | owner, admin | `auth.py:2509` |
| DELETE | `/api/v1/auth/admin/ip-bypass` | `(none)` | public | `auth.py:1380` |
| POST | `/api/v1/auth/admin/ip-bypass` | `require_admin` | owner, admin | `auth.py:1345` |
| GET | `/api/v1/auth/admin/ping` | `require_admin` | owner, admin | `auth.py:2504` |
| POST | `/api/v1/auth/google/callback` | `(none)` | public | `auth.py:2591` |
| POST | `/api/v1/auth/google/complete` | `get_google_completion_user` | google-completion token holder | `auth.py:2793` |
| POST | `/api/v1/auth/google/link` | `get_current_user` | any authenticated | `auth.py:2898` |
| GET | `/api/v1/auth/google/link/start` | `get_current_user` | any authenticated | `auth.py:2869` |
| GET | `/api/v1/auth/google/start` | `(none)` | public | `auth.py:2570` |
| POST | `/api/v1/auth/google/unlink` | `require_complete_profile` | any authenticated + complete profile | `auth.py:2952` |
| POST | `/api/v1/auth/login` | `(none)` | public | `auth.py:661` |
| POST | `/api/v1/auth/login/2fa` | `(none)` | public | `auth.py:752` |
| POST | `/api/v1/auth/logout` | `(none)` | public | `auth.py:1320` |
| GET | `/api/v1/auth/me` | `get_current_user` | any authenticated | `auth.py:1498` |
| PATCH | `/api/v1/auth/me` | `get_current_user` | any authenticated | `auth.py:2400` |
| GET | `/api/v1/auth/me/2fa` | `get_current_user` | any authenticated | `auth.py:1503` |
| POST | `/api/v1/auth/me/2fa/disable` | `get_current_user` | any authenticated | `auth.py:1572` |
| POST | `/api/v1/auth/me/2fa/enable` | `get_current_user` | any authenticated | `auth.py:1550` |
| POST | `/api/v1/auth/me/2fa/recovery-codes/regenerate` | `get_current_user` | any authenticated | `auth.py:1610` |
| POST | `/api/v1/auth/me/2fa/setup` | `get_current_user` | any authenticated | `auth.py:1522` |
| GET | `/api/v1/auth/me/aliases` | `get_current_user` | any authenticated | `auth.py:1646` |
| DELETE | `/api/v1/auth/me/avatar` | `get_current_user` | any authenticated | `auth.py:2492` |
| POST | `/api/v1/auth/me/avatar` | `get_current_user` | any authenticated | `auth.py:2443` |
| POST | `/api/v1/auth/me/avatar/use-google` | `get_current_user` | any authenticated | `auth.py:2475` |
| GET | `/api/v1/auth/me/cooldowns` | `get_current_user` | any authenticated | `auth.py:1674` |
| POST | `/api/v1/auth/me/delete` | `get_current_user` | any authenticated | `auth.py:2130` |
| POST | `/api/v1/auth/me/delete/cancel` | `get_current_user` | any authenticated | `auth.py:2168` |
| GET | `/api/v1/auth/me/delete/status` | `get_current_user` | any authenticated | `auth.py:2118` |
| PATCH | `/api/v1/auth/me/email` | `get_current_user` | any authenticated | `auth.py:1773` |
| GET | `/api/v1/auth/me/emails` | `get_current_user` | any authenticated | `auth.py:1823` |
| POST | `/api/v1/auth/me/emails` | `get_current_user` | any authenticated | `auth.py:1841` |
| POST | `/api/v1/auth/me/emails/verify/confirm` | `(none)` | public | `auth.py:1895` |
| DELETE | `/api/v1/auth/me/emails/{secondary_email_id}` | `get_current_user` | any authenticated | `auth.py:1939` |
| POST | `/api/v1/auth/me/emails/{secondary_email_id}/make-primary` | `get_current_user` | any authenticated | `auth.py:1910` |
| POST | `/api/v1/auth/me/emails/{secondary_email_id}/verify/request` | `get_current_user` | any authenticated | `auth.py:1867` |
| GET | `/api/v1/auth/me/export` | `get_current_user` | any authenticated | `auth.py:1957` |
| POST | `/api/v1/auth/me/export/jobs` | `get_current_user` | any authenticated | `auth.py:1970` |
| GET | `/api/v1/auth/me/export/jobs/latest` | `get_current_user` | any authenticated | `auth.py:2036` |
| GET | `/api/v1/auth/me/export/jobs/{job_id}` | `get_current_user` | any authenticated | `auth.py:2060` |
| GET | `/api/v1/auth/me/export/jobs/{job_id}/download` | `get_current_user` | any authenticated | `auth.py:2074` |
| PATCH | `/api/v1/auth/me/language` | `get_current_user` | any authenticated | `auth.py:2186` |
| PATCH | `/api/v1/auth/me/notifications` | `get_current_user` | any authenticated | `auth.py:2199` |
| GET | `/api/v1/auth/me/passkeys` | `get_current_user` | any authenticated | `auth.py:1010` |
| POST | `/api/v1/auth/me/passkeys/register/options` | `get_current_user` | any authenticated | `auth.py:1021` |
| POST | `/api/v1/auth/me/passkeys/register/verify` | `get_current_user` | any authenticated | `auth.py:1054` |
| DELETE | `/api/v1/auth/me/passkeys/{passkey_id}` | `get_current_user` | any authenticated | `auth.py:1108` |
| GET | `/api/v1/auth/me/security-events` | `get_current_user` | any authenticated | `auth.py:2359` |
| GET | `/api/v1/auth/me/sessions` | `get_current_user` | any authenticated | `auth.py:2242` |
| POST | `/api/v1/auth/me/sessions/revoke-others` | `get_current_user` | any authenticated | `auth.py:2299` |
| PATCH | `/api/v1/auth/me/training-mode` | `get_current_user` | any authenticated | `auth.py:2219` |
| PATCH | `/api/v1/auth/me/username` | `get_current_user` | any authenticated | `auth.py:1754` |
| POST | `/api/v1/auth/passkeys/login/options` | `(none)` | public | `auth.py:859` |
| POST | `/api/v1/auth/passkeys/login/verify` | `(none)` | public | `auth.py:899` |
| POST | `/api/v1/auth/password-reset/confirm` | `(none)` | public | `auth.py:2546` |
| POST | `/api/v1/auth/password-reset/request` | `(none)` | public | `auth.py:2526` |
| POST | `/api/v1/auth/password/change` | `get_current_user` | any authenticated | `auth.py:1436` |
| POST | `/api/v1/auth/refresh` | `(none)` | public | `auth.py:1141` |
| POST | `/api/v1/auth/register` | `(none)` | public | `auth.py:577` |
| POST | `/api/v1/auth/step-up` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `auth.py:1400` |
| POST | `/api/v1/auth/verify/confirm` | `(none)` | public | `auth.py:1489` |
| POST | `/api/v1/auth/verify/request` | `get_current_user` | any authenticated | `auth.py:1470` |
| GET | `/api/v1/blog/admin/comments/flagged` | `require_admin_section('content')` | owner, admin, content | `blog.py:798` |
| POST | `/api/v1/blog/admin/comments/{comment_id}/hide` | `require_admin_section('content')` | owner, admin, content | `blog.py:817` |
| POST | `/api/v1/blog/admin/comments/{comment_id}/resolve-flags` | `require_admin_section('content')` | owner, admin, content | `blog.py:856` |
| POST | `/api/v1/blog/admin/comments/{comment_id}/unhide` | `require_admin_section('content')` | owner, admin, content | `blog.py:839` |
| DELETE | `/api/v1/blog/comments/{comment_id}` | `require_complete_profile` | any authenticated + complete profile | `blog.py:769` |
| POST | `/api/v1/blog/comments/{comment_id}/flag` | `require_complete_profile` | any authenticated + complete profile | `blog.py:781` |
| GET | `/api/v1/blog/feed.json` | `(none)` | public | `blog.py:268` |
| GET | `/api/v1/blog/me/comments` | `require_complete_profile` | any authenticated + complete profile | `blog.py:638` |
| GET | `/api/v1/blog/posts` | `(none)` | public | `blog.py:168` |
| GET | `/api/v1/blog/posts/{slug}` | `(none)` | public | `blog.py:330` |
| GET | `/api/v1/blog/posts/{slug}/comment-subscription` | `require_complete_profile` | any authenticated + complete profile | `blog.py:600` |
| PUT | `/api/v1/blog/posts/{slug}/comment-subscription` | `require_verified_email` | any authenticated + verified email | `blog.py:617` |
| GET | `/api/v1/blog/posts/{slug}/comment-threads` | `(none)` | public | `blog.py:562` |
| GET | `/api/v1/blog/posts/{slug}/comments` | `(none)` | public | `blog.py:535` |
| POST | `/api/v1/blog/posts/{slug}/comments` | `require_complete_profile` | any authenticated + complete profile | `blog.py:658` |
| GET | `/api/v1/blog/posts/{slug}/neighbors` | `(none)` | public | `blog.py:392` |
| GET | `/api/v1/blog/posts/{slug}/og-preview.png` | `(none)` | public | `blog.py:506` |
| GET | `/api/v1/blog/posts/{slug}/og.png` | `(none)` | public | `blog.py:464` |
| GET | `/api/v1/blog/posts/{slug}/preview` | `(none)` | public | `blog.py:416` |
| POST | `/api/v1/blog/posts/{slug}/preview-token` | `require_admin_section('content')` | owner, admin, content | `blog.py:437` |
| GET | `/api/v1/blog/rss.xml` | `(none)` | public | `blog.py:202` |
| GET | `/api/v1/cart` | `get_current_user_optional` | public (identity used if present) | `cart.py:25` |
| POST | `/api/v1/cart/items` | `get_current_user_optional` | public (identity used if present) | `cart.py:100` |
| DELETE | `/api/v1/cart/items/{item_id}` | `get_current_user_optional` | public (identity used if present) | `cart.py:145` |
| PATCH | `/api/v1/cart/items/{item_id}` | `get_current_user_optional` | public (identity used if present) | `cart.py:123` |
| POST | `/api/v1/cart/merge` | `get_current_user_optional` | public (identity used if present) | `cart.py:159` |
| POST | `/api/v1/cart/promo/validate` | `(none)` | public | `cart.py:180` |
| POST | `/api/v1/cart/sync` | `get_current_user_optional` | public (identity used if present) | `cart.py:188` |
| GET | `/api/v1/catalog/categories` | `get_current_user_optional` | public (identity used if present) | `catalog.py:99` |
| POST | `/api/v1/catalog/categories` | `require_admin_section('products')` | owner, admin, content | `catalog.py:262` |
| GET | `/api/v1/catalog/categories/export` | `require_admin_section('products')` | owner, admin, content | `catalog.py:442` |
| POST | `/api/v1/catalog/categories/import` | `require_admin_section('products')` | owner, admin, content | `catalog.py:456` |
| POST | `/api/v1/catalog/categories/reorder` | `require_admin_section('products')` | owner, admin, content | `catalog.py:422` |
| DELETE | `/api/v1/catalog/categories/{slug}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:396` |
| PATCH | `/api/v1/catalog/categories/{slug}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:288` |
| GET | `/api/v1/catalog/categories/{slug}/delete/preview` | `require_admin_section('products')` | owner, admin, content | `catalog.py:535` |
| POST | `/api/v1/catalog/categories/{slug}/images/{kind}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:480` |
| POST | `/api/v1/catalog/categories/{slug}/merge` | `require_admin_section('products')` | owner, admin, content | `catalog.py:620` |
| GET | `/api/v1/catalog/categories/{slug}/merge/preview` | `require_admin_section('products')` | owner, admin, content | `catalog.py:567` |
| GET | `/api/v1/catalog/categories/{slug}/translations` | `require_admin_section('products')` | owner, admin, content | `catalog.py:318` |
| DELETE | `/api/v1/catalog/categories/{slug}/translations/{lang}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:366` |
| PUT | `/api/v1/catalog/categories/{slug}/translations/{lang}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:335` |
| GET | `/api/v1/catalog/collections/featured` | `(none)` | public | `catalog.py:952` |
| POST | `/api/v1/catalog/collections/featured` | `require_admin_section('products')` | owner, admin, content | `catalog.py:983` |
| PATCH | `/api/v1/catalog/collections/featured/{slug}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:997` |
| GET | `/api/v1/catalog/products` | `get_current_user_optional` | public (identity used if present) | `catalog.py:124` |
| POST | `/api/v1/catalog/products` | `require_admin_section('products')` | owner, admin, content | `catalog.py:691` |
| POST | `/api/v1/catalog/products/bulk-update` | `require_admin_section('products')` | owner, admin, content | `catalog.py:919` |
| GET | `/api/v1/catalog/products/export` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1075` |
| GET | `/api/v1/catalog/products/feed` | `(none)` | public | `catalog.py:241` |
| GET | `/api/v1/catalog/products/feed.csv` | `(none)` | public | `catalog.py:249` |
| POST | `/api/v1/catalog/products/import` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1087` |
| GET | `/api/v1/catalog/products/price-bounds` | `get_current_user_optional` | public (identity used if present) | `catalog.py:203` |
| GET | `/api/v1/catalog/products/recently-viewed` | `get_current_user_optional` | public (identity used if present) | `catalog.py:1045` |
| DELETE | `/api/v1/catalog/products/{slug}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:853` |
| GET | `/api/v1/catalog/products/{slug}` | `get_current_user_optional` | public (identity used if present) | `catalog.py:1111` |
| PATCH | `/api/v1/catalog/products/{slug}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:704` |
| GET | `/api/v1/catalog/products/{slug}/audit` | `require_admin_section('products')` | owner, admin, content | `catalog.py:811` |
| DELETE | `/api/v1/catalog/products/{slug}/back-in-stock` | `require_complete_profile` | any authenticated + complete profile | `catalog.py:1222` |
| GET | `/api/v1/catalog/products/{slug}/back-in-stock` | `require_complete_profile` | any authenticated + complete profile | `catalog.py:1165` |
| POST | `/api/v1/catalog/products/{slug}/back-in-stock` | `require_complete_profile` | any authenticated + complete profile | `catalog.py:1195` |
| POST | `/api/v1/catalog/products/{slug}/duplicate` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1015` |
| POST | `/api/v1/catalog/products/{slug}/images` | `require_admin_section('products')` | owner, admin, content | `catalog.py:868` |
| GET | `/api/v1/catalog/products/{slug}/images/deleted` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1319` |
| DELETE | `/api/v1/catalog/products/{slug}/images/{image_id}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1249` |
| POST | `/api/v1/catalog/products/{slug}/images/{image_id}/reprocess` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1493` |
| POST | `/api/v1/catalog/products/{slug}/images/{image_id}/restore` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1345` |
| PATCH | `/api/v1/catalog/products/{slug}/images/{image_id}/sort` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1281` |
| GET | `/api/v1/catalog/products/{slug}/images/{image_id}/stats` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1466` |
| GET | `/api/v1/catalog/products/{slug}/images/{image_id}/translations` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1372` |
| DELETE | `/api/v1/catalog/products/{slug}/images/{image_id}/translations/{lang}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1436` |
| PUT | `/api/v1/catalog/products/{slug}/images/{image_id}/translations/{lang}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1400` |
| GET | `/api/v1/catalog/products/{slug}/related` | `get_current_user_optional` | public (identity used if present) | `catalog.py:1583` |
| GET | `/api/v1/catalog/products/{slug}/relationships` | `require_admin_section('products')` | owner, admin, content | `catalog.py:780` |
| PUT | `/api/v1/catalog/products/{slug}/relationships` | `require_admin_section('products')` | owner, admin, content | `catalog.py:794` |
| POST | `/api/v1/catalog/products/{slug}/reviews` | `get_current_user_optional` | public (identity used if present) | `catalog.py:1520` |
| POST | `/api/v1/catalog/products/{slug}/reviews/{review_id}/approve` | `require_admin_section('products')` | owner, admin, content | `catalog.py:1555` |
| GET | `/api/v1/catalog/products/{slug}/translations` | `require_admin_section('products')` | owner, admin, content | `catalog.py:722` |
| DELETE | `/api/v1/catalog/products/{slug}/translations/{lang}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:760` |
| PUT | `/api/v1/catalog/products/{slug}/translations/{lang}` | `require_admin_section('products')` | owner, admin, content | `catalog.py:739` |
| GET | `/api/v1/catalog/products/{slug}/upsells` | `get_current_user_optional` | public (identity used if present) | `catalog.py:1632` |
| PUT | `/api/v1/catalog/products/{slug}/variants` | `require_admin_section('products')` | owner, admin, content | `catalog.py:932` |
| GET | `/api/v1/content/admin/assets/images` | `require_admin_section('content')` | owner, admin, content | `content.py:982` |
| DELETE | `/api/v1/content/admin/assets/images/{image_id}` | `require_admin_section('content')` | owner, admin, content | `content.py:1391` |
| PATCH | `/api/v1/content/admin/assets/images/{image_id}` | `require_admin_section('content')` | owner, admin, content | `content.py:1106` |
| POST | `/api/v1/content/admin/assets/images/{image_id}/edit` | `require_admin_section('content')` | owner, admin, content | `content.py:1292` |
| PATCH | `/api/v1/content/admin/assets/images/{image_id}/focal` | `require_admin_section('content')` | owner, admin, content | `content.py:1232` |
| PATCH | `/api/v1/content/admin/assets/images/{image_id}/tags` | `require_admin_section('content')` | owner, admin, content | `content.py:1164` |
| GET | `/api/v1/content/admin/assets/images/{image_id}/usage` | `require_admin_section('content')` | owner, admin, content | `content.py:1353` |
| GET | `/api/v1/content/admin/media/assets` | `require_admin_section('content')` | owner, admin, content | `content.py:1416` |
| POST | `/api/v1/content/admin/media/assets/upload` | `require_admin_section('content')` | owner, admin, content | `content.py:1472` |
| DELETE | `/api/v1/content/admin/media/assets/{asset_id}` | `require_admin_section('content')` | owner, admin, content | `content.py:1643` |
| PATCH | `/api/v1/content/admin/media/assets/{asset_id}` | `require_admin_section('content')` | owner, admin, content | `content.py:1575` |
| POST | `/api/v1/content/admin/media/assets/{asset_id}/approve` | `require_admin_section('content')` | owner, admin, content | `content.py:1594` |
| POST | `/api/v1/content/admin/media/assets/{asset_id}/edit` | `require_admin_section('content')` | owner, admin, content | `content.py:1773` |
| POST | `/api/v1/content/admin/media/assets/{asset_id}/finalize` | `require_admin_section('content')` | owner, admin, content | `content.py:1508` |
| GET | `/api/v1/content/admin/media/assets/{asset_id}/preview` | `(none)` | public | `content.py:1709` |
| POST | `/api/v1/content/admin/media/assets/{asset_id}/purge` | `require_admin_section('content')` | owner, admin, content | `content.py:1675` |
| POST | `/api/v1/content/admin/media/assets/{asset_id}/reject` | `require_admin_section('content')` | owner, admin, content | `content.py:1619` |
| POST | `/api/v1/content/admin/media/assets/{asset_id}/restore` | `require_admin_section('content')` | owner, admin, content | `content.py:1659` |
| GET | `/api/v1/content/admin/media/assets/{asset_id}/usage` | `require_admin_section('content')` | owner, admin, content | `content.py:1694` |
| POST | `/api/v1/content/admin/media/assets/{asset_id}/variants` | `require_admin_section('content')` | owner, admin, content | `content.py:1748` |
| GET | `/api/v1/content/admin/media/collections` | `require_admin_section('content')` | owner, admin, content | `content.py:2135` |
| POST | `/api/v1/content/admin/media/collections` | `require_admin_section('content')` | owner, admin, content | `content.py:2143` |
| PATCH | `/api/v1/content/admin/media/collections/{collection_id}` | `require_admin_section('content')` | owner, admin, content | `content.py:2158` |
| POST | `/api/v1/content/admin/media/collections/{collection_id}/items` | `require_admin_section('content')` | owner, admin, content | `content.py:2172` |
| GET | `/api/v1/content/admin/media/jobs` | `require_admin_section('content')` | owner, admin, content | `content.py:1798` |
| POST | `/api/v1/content/admin/media/jobs/retry-bulk` | `require_admin_section('content')` | owner, admin, content | `content.py:2065` |
| GET | `/api/v1/content/admin/media/jobs/{job_id}` | `require_admin_section('content')` | owner, admin, content | `content.py:2034` |
| GET | `/api/v1/content/admin/media/jobs/{job_id}/events` | `require_admin_section('content')` | owner, admin, content | `content.py:2116` |
| POST | `/api/v1/content/admin/media/jobs/{job_id}/retry` | `require_admin_section('content')` | owner, admin, content | `content.py:2049` |
| PATCH | `/api/v1/content/admin/media/jobs/{job_id}/triage` | `require_admin_section('content')` | owner, admin, content | `content.py:2085` |
| GET | `/api/v1/content/admin/media/retry-policies` | `require_admin_section('content')` | owner, admin, content | `content.py:1864` |
| GET | `/api/v1/content/admin/media/retry-policies/history` | `require_admin_section('content')` | owner, admin, content | `content.py:1873` |
| POST | `/api/v1/content/admin/media/retry-policies/reset-all` | `require_admin_section('content')` | owner, admin, content | `content.py:1997` |
| PATCH | `/api/v1/content/admin/media/retry-policies/{job_type}` | `require_admin_section('content')` | owner, admin, content | `content.py:1911` |
| POST | `/api/v1/content/admin/media/retry-policies/{job_type}/mark-known-good` | `require_admin_section('content')` | owner, admin, content | `content.py:1956` |
| GET | `/api/v1/content/admin/media/retry-policies/{job_type}/presets` | `require_admin_section('content')` | owner, admin, content | `content.py:1896` |
| POST | `/api/v1/content/admin/media/retry-policies/{job_type}/reset` | `require_admin_section('content')` | owner, admin, content | `content.py:1980` |
| POST | `/api/v1/content/admin/media/retry-policies/{job_type}/rollback` | `require_admin_section('content')` | owner, admin, content | `content.py:1932` |
| GET | `/api/v1/content/admin/media/telemetry` | `require_admin_section('content')` | owner, admin, content | `content.py:1856` |
| POST | `/api/v1/content/admin/media/usage/reconcile` | `require_admin_section('content')` | owner, admin, content | `content.py:2011` |
| GET | `/api/v1/content/admin/pages/list` | `require_admin_section('content')` | owner, admin, content | `content.py:2273` |
| POST | `/api/v1/content/admin/pages/{slug}/rename` | `require_admin_section('content')` | owner, admin, content | `content.py:2318` |
| GET | `/api/v1/content/admin/redirects` | `require_admin_section('content')` | owner, admin, content | `content.py:499` |
| POST | `/api/v1/content/admin/redirects` | `require_admin_section('content')` | owner, admin, content | `content.py:581` |
| GET | `/api/v1/content/admin/redirects/export` | `require_admin_section('content')` | owner, admin, content | `content.py:652` |
| POST | `/api/v1/content/admin/redirects/import` | `require_admin_section('content')` | owner, admin, content | `content.py:698` |
| DELETE | `/api/v1/content/admin/redirects/{redirect_id}` | `require_admin_section('content')` | owner, admin, content | `content.py:873` |
| GET | `/api/v1/content/admin/scheduling` | `require_admin_section('content')` | owner, admin, content | `content.py:407` |
| GET | `/api/v1/content/admin/seo/sitemap-preview` | `require_admin_section('content')` | owner, admin, content | `content.py:852` |
| GET | `/api/v1/content/admin/seo/structured-data/validate` | `require_admin_section('content')` | owner, admin, content | `content.py:861` |
| POST | `/api/v1/content/admin/social/thumbnail` | `require_admin_section('content')` | owner, admin, content | `content.py:379` |
| POST | `/api/v1/content/admin/tools/find-replace/apply` | `require_admin_section('content')` | owner, admin, content | `content.py:2244` |
| POST | `/api/v1/content/admin/tools/find-replace/preview` | `require_admin_section('content')` | owner, admin, content | `content.py:2214` |
| GET | `/api/v1/content/admin/tools/link-check` | `require_admin_section('content')` | owner, admin, content | `content.py:2188` |
| POST | `/api/v1/content/admin/tools/link-check/preview` | `require_admin_section('content')` | owner, admin, content | `content.py:2198` |
| DELETE | `/api/v1/content/admin/{key}` | `require_admin_section('content')` | owner, admin, content | `content.py:917` |
| GET | `/api/v1/content/admin/{key}` | `require_admin_section('content')` | owner, admin, content | `content.py:891` |
| PATCH | `/api/v1/content/admin/{key}` | `require_admin_section('content')` | owner, admin, content | `content.py:906` |
| POST | `/api/v1/content/admin/{key}` | `require_admin_section('content')` | owner, admin, content | `content.py:938` |
| GET | `/api/v1/content/admin/{key}/audit` | `require_admin_section('content')` | owner, admin, content | `content.py:2355` |
| POST | `/api/v1/content/admin/{key}/images` | `require_admin_section('content')` | owner, admin, content | `content.py:957` |
| GET | `/api/v1/content/admin/{key}/preview` | `(none)` | public | `content.py:2336` |
| PATCH | `/api/v1/content/admin/{key}/translation-status` | `require_admin_section('content')` | owner, admin, content | `content.py:2305` |
| GET | `/api/v1/content/admin/{key}/versions` | `require_admin_section('content')` | owner, admin, content | `content.py:2369` |
| GET | `/api/v1/content/admin/{key}/versions/{version}` | `require_admin_section('content')` | owner, admin, content | `content.py:2391` |
| POST | `/api/v1/content/admin/{key}/versions/{version}/rollback` | `require_admin_section('content')` | owner, admin, content | `content.py:2417` |
| GET | `/api/v1/content/home/preview` | `(none)` | public | `content.py:323` |
| POST | `/api/v1/content/home/preview-token` | `require_admin_section('content')` | owner, admin, content | `content.py:352` |
| GET | `/api/v1/content/pages/{slug}` | `get_current_user_optional` | public (identity used if present) | `content.py:195` |
| GET | `/api/v1/content/pages/{slug}/preview` | `get_current_user_optional` | public (identity used if present) | `content.py:226` |
| POST | `/api/v1/content/pages/{slug}/preview-token` | `require_admin_section('content')` | owner, admin, content | `content.py:255` |
| GET | `/api/v1/content/{key}` | `get_current_user_optional` | public (identity used if present) | `content.py:287` |
| GET | `/api/v1/coupons/admin/analytics` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:908` |
| GET | `/api/v1/coupons/admin/coupons` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:621` |
| POST | `/api/v1/coupons/admin/coupons` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:726` |
| GET | `/api/v1/coupons/admin/coupons/bulk-jobs` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:2265` |
| GET | `/api/v1/coupons/admin/coupons/bulk-jobs/{job_id}` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:2251` |
| POST | `/api/v1/coupons/admin/coupons/bulk-jobs/{job_id}/cancel` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:2309` |
| POST | `/api/v1/coupons/admin/coupons/bulk-jobs/{job_id}/retry` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:2335` |
| POST | `/api/v1/coupons/admin/coupons/generate-code` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:782` |
| POST | `/api/v1/coupons/admin/coupons/issue` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:801` |
| PATCH | `/api/v1/coupons/admin/coupons/{coupon_id}` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:647` |
| POST | `/api/v1/coupons/admin/coupons/{coupon_id}/assign` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:1703` |
| POST | `/api/v1/coupons/admin/coupons/{coupon_id}/assign/bulk` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:1776` |
| POST | `/api/v1/coupons/admin/coupons/{coupon_id}/assign/segment` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:2130` |
| POST | `/api/v1/coupons/admin/coupons/{coupon_id}/assign/segment/preview` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:2068` |
| GET | `/api/v1/coupons/admin/coupons/{coupon_id}/assignments` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:691` |
| GET | `/api/v1/coupons/admin/coupons/{coupon_id}/bulk-jobs` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:2285` |
| POST | `/api/v1/coupons/admin/coupons/{coupon_id}/revoke` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:1891` |
| POST | `/api/v1/coupons/admin/coupons/{coupon_id}/revoke/bulk` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:1957` |
| POST | `/api/v1/coupons/admin/coupons/{coupon_id}/revoke/segment` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:2190` |
| POST | `/api/v1/coupons/admin/coupons/{coupon_id}/revoke/segment/preview` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:2099` |
| GET | `/api/v1/coupons/admin/promotions` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:392` |
| POST | `/api/v1/coupons/admin/promotions` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:406` |
| PATCH | `/api/v1/coupons/admin/promotions/{promotion_id}` | `require_admin_section('coupons')` | owner, admin, content | `coupons_v2.py:481` |
| GET | `/api/v1/coupons/eligibility` | `get_current_user` | any authenticated | `coupons_v2.py:302` |
| GET | `/api/v1/coupons/me` | `get_current_user` | any authenticated | `coupons_v2.py:374` |
| POST | `/api/v1/coupons/validate` | `get_current_user` | any authenticated | `coupons_v2.py:335` |
| GET | `/api/v1/email-preview` | `require_admin` | owner, admin | `email_preview.py:9` |
| GET | `/api/v1/feeds/products.json` | `(none)` | public | `routes.py:127` |
| DELETE | `/api/v1/fx/admin/override` | `require_admin` | owner, admin | `fx.py:45` |
| PUT | `/api/v1/fx/admin/override` | `require_admin` | owner, admin | `fx.py:36` |
| GET | `/api/v1/fx/admin/override/audit` | `require_admin` | owner, admin | `fx.py:53` |
| POST | `/api/v1/fx/admin/override/audit/{audit_id}/revert` | `require_admin` | owner, admin | `fx.py:82` |
| GET | `/api/v1/fx/admin/status` | `require_admin` | owner, admin | `fx.py:28` |
| GET | `/api/v1/fx/rates` | `(none)` | public | `fx.py:23` |
| GET | `/api/v1/health` | `(none)` | public | `routes.py:74` |
| GET | `/api/v1/health/ready` | `(none)` | public | `routes.py:79` |
| GET | `/api/v1/legal/consents/status` | `get_current_user_optional` | public (identity used if present) | `legal.py:18` |
| GET | `/api/v1/me/addresses` | `require_complete_profile` | any authenticated + complete profile | `addresses.py:14` |
| POST | `/api/v1/me/addresses` | `require_complete_profile` | any authenticated + complete profile | `addresses.py:22` |
| DELETE | `/api/v1/me/addresses/{address_id}` | `require_complete_profile` | any authenticated + complete profile | `addresses.py:46` |
| PATCH | `/api/v1/me/addresses/{address_id}` | `require_complete_profile` | any authenticated + complete profile | `addresses.py:31` |
| GET | `/api/v1/metrics` | `require_admin_section('ops')` | owner, admin | `routes.py:91` |
| GET | `/api/v1/newsletter/admin/export` | `require_admin_section('ops')` | owner, admin | `newsletter.py:277` |
| POST | `/api/v1/newsletter/confirm` | `(none)` | public | `newsletter.py:146` |
| POST | `/api/v1/newsletter/subscribe` | `(none)` | public | `newsletter.py:48` |
| POST | `/api/v1/newsletter/unsubscribe` | `(none)` | public | `newsletter.py:218` |
| GET | `/api/v1/notifications` | `get_current_user` | any authenticated | `notifications.py:19` |
| GET | `/api/v1/notifications/unread-count` | `get_current_user` | any authenticated | `notifications.py:39` |
| POST | `/api/v1/notifications/{notification_id}/dismiss` | `get_current_user` | any authenticated | `notifications.py:64` |
| POST | `/api/v1/notifications/{notification_id}/read` | `get_current_user` | any authenticated | `notifications.py:48` |
| POST | `/api/v1/notifications/{notification_id}/restore` | `get_current_user` | any authenticated | `notifications.py:80` |
| GET | `/api/v1/ops/admin/banners` | `require_admin_section('ops')` | owner, admin | `ops.py:56` |
| POST | `/api/v1/ops/admin/banners` | `require_admin_section('ops')` | owner, admin | `ops.py:72` |
| DELETE | `/api/v1/ops/admin/banners/{banner_id}` | `require_admin_section('ops')` | owner, admin | `ops.py:158` |
| PATCH | `/api/v1/ops/admin/banners/{banner_id}` | `require_admin_section('ops')` | owner, admin | `ops.py:112` |
| GET | `/api/v1/ops/admin/diagnostics` | `require_admin_section('ops')` | owner, admin | `ops.py:65` |
| GET | `/api/v1/ops/admin/email-events` | `require_admin_section('ops')` | owner, admin | `ops.py:306` |
| GET | `/api/v1/ops/admin/email-failures` | `require_admin_section('ops')` | owner, admin | `ops.py:292` |
| GET | `/api/v1/ops/admin/email-failures/stats` | `require_admin_section('ops')` | owner, admin | `ops.py:282` |
| POST | `/api/v1/ops/admin/shipping-simulate` | `require_admin_section('ops')` | owner, admin | `ops.py:191` |
| GET | `/api/v1/ops/admin/webhooks` | `require_admin_section('ops')` | owner, admin | `ops.py:207` |
| GET | `/api/v1/ops/admin/webhooks/backlog` | `require_admin_section('ops')` | owner, admin | `ops.py:226` |
| GET | `/api/v1/ops/admin/webhooks/stats` | `require_admin_section('ops')` | owner, admin | `ops.py:216` |
| GET | `/api/v1/ops/admin/webhooks/{provider}/{event_id}` | `require_admin_section('ops')` | owner, admin | `ops.py:241` |
| POST | `/api/v1/ops/admin/webhooks/{provider}/{event_id}/retry` | `require_admin_section('ops')` | owner, admin | `ops.py:253` |
| GET | `/api/v1/ops/banner` | `(none)` | public | `ops.py:42` |
| GET | `/api/v1/orders` | `require_complete_profile` | any authenticated + complete profile | `orders.py:1615` |
| POST | `/api/v1/orders` | `require_verified_email` | any authenticated + verified email | `orders.py:483` |
| GET | `/api/v1/orders/admin` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:1668` |
| POST | `/api/v1/orders/admin/batch/packing-slips` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3749` |
| POST | `/api/v1/orders/admin/batch/pick-list.csv` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3803` |
| POST | `/api/v1/orders/admin/batch/pick-list.pdf` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3853` |
| POST | `/api/v1/orders/admin/batch/shipping-labels.zip` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3901` |
| GET | `/api/v1/orders/admin/export` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:1869` |
| GET | `/api/v1/orders/admin/exports` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:1967` |
| GET | `/api/v1/orders/admin/exports/{export_id}/download` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:2006` |
| GET | `/api/v1/orders/admin/search` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:1678` |
| GET | `/api/v1/orders/admin/tags` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:1834` |
| POST | `/api/v1/orders/admin/tags/rename` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:1854` |
| GET | `/api/v1/orders/admin/tags/stats` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:1843` |
| GET | `/api/v1/orders/admin/{order_id}` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:2129` |
| PATCH | `/api/v1/orders/admin/{order_id}` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:2836` |
| PATCH | `/api/v1/orders/admin/{order_id}/addresses` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3030` |
| POST | `/api/v1/orders/admin/{order_id}/capture-payment` | `require_admin` | owner, admin | `orders.py:4033` |
| POST | `/api/v1/orders/admin/{order_id}/confirmation-email` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3630` |
| POST | `/api/v1/orders/admin/{order_id}/delivery-email` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3588` |
| GET | `/api/v1/orders/admin/{order_id}/email-events` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:2151` |
| GET | `/api/v1/orders/admin/{order_id}/events` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3706` |
| POST | `/api/v1/orders/admin/{order_id}/fraud-review` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3559` |
| POST | `/api/v1/orders/admin/{order_id}/items/{item_id}/fulfill` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3678` |
| POST | `/api/v1/orders/admin/{order_id}/notes` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3481` |
| GET | `/api/v1/orders/admin/{order_id}/packing-slip` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3720` |
| GET | `/api/v1/orders/admin/{order_id}/receipt` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:4001` |
| POST | `/api/v1/orders/admin/{order_id}/refund` | `require_admin` | owner, admin | `orders.py:3344` |
| POST | `/api/v1/orders/admin/{order_id}/refunds` | `require_admin` | owner, admin | `orders.py:3409` |
| POST | `/api/v1/orders/admin/{order_id}/retry-payment` | `require_admin` | owner, admin | `orders.py:3330` |
| GET | `/api/v1/orders/admin/{order_id}/shipments` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3062` |
| POST | `/api/v1/orders/admin/{order_id}/shipments` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3076` |
| DELETE | `/api/v1/orders/admin/{order_id}/shipments/{shipment_id}` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3142` |
| PATCH | `/api/v1/orders/admin/{order_id}/shipments/{shipment_id}` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3107` |
| DELETE | `/api/v1/orders/admin/{order_id}/shipping-label` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3295` |
| GET | `/api/v1/orders/admin/{order_id}/shipping-label` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3250` |
| POST | `/api/v1/orders/admin/{order_id}/shipping-label` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3175` |
| POST | `/api/v1/orders/admin/{order_id}/tags` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3507` |
| DELETE | `/api/v1/orders/admin/{order_id}/tags/{tag}` | `require_admin_section('orders')` | owner, admin, fulfillment | `orders.py:3533` |
| POST | `/api/v1/orders/admin/{order_id}/void-payment` | `require_admin` | owner, admin | `orders.py:4083` |
| POST | `/api/v1/orders/checkout` | `require_verified_email` | any authenticated + verified email | `orders.py:595` |
| POST | `/api/v1/orders/guest-checkout` | `(none)` | public | `orders.py:2332` |
| POST | `/api/v1/orders/guest-checkout/email/confirm` | `(none)` | public | `orders.py:2259` |
| POST | `/api/v1/orders/guest-checkout/email/request` | `(none)` | public | `orders.py:2216` |
| GET | `/api/v1/orders/guest-checkout/email/status` | `(none)` | public | `orders.py:2317` |
| GET | `/api/v1/orders/me` | `require_complete_profile` | any authenticated + complete profile | `orders.py:1624` |
| POST | `/api/v1/orders/netopia/confirm` | `get_current_user_optional` | public (identity used if present) | `orders.py:1440` |
| POST | `/api/v1/orders/paypal/capture` | `get_current_user_optional` | public (identity used if present) | `orders.py:1105` |
| GET | `/api/v1/orders/receipt/{token}` | `get_current_user_optional` | public (identity used if present) | `orders.py:4186` |
| GET | `/api/v1/orders/receipt/{token}/pdf` | `get_current_user_optional` | public (identity used if present) | `orders.py:4229` |
| GET | `/api/v1/orders/shipping-methods` | `(none)` | public | `orders.py:4144` |
| POST | `/api/v1/orders/shipping-methods` | `require_admin` | owner, admin | `orders.py:4131` |
| POST | `/api/v1/orders/stripe/confirm` | `get_current_user_optional` | public (identity used if present) | `orders.py:1265` |
| GET | `/api/v1/orders/{order_id}` | `require_complete_profile` | any authenticated + complete profile | `orders.py:4152` |
| POST | `/api/v1/orders/{order_id}/cancel-request` | `require_verified_email` | any authenticated + verified email | `orders.py:4381` |
| GET | `/api/v1/orders/{order_id}/receipt` | `require_complete_profile` | any authenticated + complete profile | `orders.py:4166` |
| POST | `/api/v1/orders/{order_id}/receipt/revoke` | `require_complete_profile` | any authenticated + complete profile | `orders.py:4325` |
| POST | `/api/v1/orders/{order_id}/receipt/share` | `require_complete_profile` | any authenticated + complete profile | `orders.py:4283` |
| POST | `/api/v1/orders/{order_id}/reorder` | `require_complete_profile` | any authenticated + complete profile | `orders.py:4473` |
| GET | `/api/v1/payments/capabilities` | `(none)` | public | `payments.py:76` |
| POST | `/api/v1/payments/intent` | `get_current_user_optional` | public (identity used if present) | `payments.py:135` |
| POST | `/api/v1/payments/netopia/webhook` | `(none)` | public | `payments.py:311` |
| POST | `/api/v1/payments/paypal/webhook` | `(none)` | public | `payments.py:200` |
| POST | `/api/v1/payments/webhook` | `(none)` | public | `payments.py:157` |
| POST | `/api/v1/returns` | `require_verified_email` | any authenticated + verified email | `returns.py:92` |
| GET | `/api/v1/returns/admin` | `require_admin_section('returns')` | owner, admin, fulfillment | `returns.py:113` |
| POST | `/api/v1/returns/admin` | `require_admin_section('returns')` | owner, admin, fulfillment | `returns.py:207` |
| GET | `/api/v1/returns/admin/by-order/{order_id}` | `require_admin_section('returns')` | owner, admin, fulfillment | `returns.py:185` |
| GET | `/api/v1/returns/admin/{return_id}` | `require_admin_section('returns')` | owner, admin, fulfillment | `returns.py:167` |
| PATCH | `/api/v1/returns/admin/{return_id}` | `require_admin_section('returns')` | owner, admin, fulfillment | `returns.py:240` |
| DELETE | `/api/v1/returns/admin/{return_id}/label` | `require_admin_section('returns')` | owner, admin, fulfillment | `returns.py:366` |
| GET | `/api/v1/returns/admin/{return_id}/label` | `require_admin_section('returns')` | owner, admin, fulfillment | `returns.py:334` |
| POST | `/api/v1/returns/admin/{return_id}/label` | `require_admin_section('returns')` | owner, admin, fulfillment | `returns.py:284` |
| GET | `/api/v1/robots.txt` | `(none)` | public | `routes.py:112` |
| GET | `/api/v1/shipping/lockers` | `(none)` | public | `shipping.py:12` |
| GET | `/api/v1/shipping/lockers/cities` | `(none)` | public | `shipping.py:40` |
| GET | `/api/v1/sitemap.xml` | `(none)` | public | `routes.py:96` |
| GET | `/api/v1/support/admin/assignees` | `require_admin_section('support')` | owner, admin, support | `support.py:327` |
| GET | `/api/v1/support/admin/canned-responses` | `require_admin_section('support')` | owner, admin, support | `support.py:371` |
| POST | `/api/v1/support/admin/canned-responses` | `require_admin_section('support')` | owner, admin, support | `support.py:383` |
| DELETE | `/api/v1/support/admin/canned-responses/{response_id}` | `require_admin_section('support')` | owner, admin, support | `support.py:430` |
| PATCH | `/api/v1/support/admin/canned-responses/{response_id}` | `require_admin_section('support')` | owner, admin, support | `support.py:404` |
| POST | `/api/v1/support/admin/feedback` | `require_admin_section('dashboard')` | owner, admin, support, fulfillment, content | `support.py:336` |
| GET | `/api/v1/support/admin/sla-settings` | `require_admin_section('support')` | owner, admin, support | `support.py:566` |
| PATCH | `/api/v1/support/admin/sla-settings` | `require_admin` | owner, admin | `support.py:588` |
| GET | `/api/v1/support/admin/submissions` | `require_admin_section('support')` | owner, admin, support | `support.py:270` |
| GET | `/api/v1/support/admin/submissions/{submission_id}` | `require_admin_section('support')` | owner, admin, support | `support.py:447` |
| PATCH | `/api/v1/support/admin/submissions/{submission_id}` | `require_admin_section('support')` | owner, admin, support | `support.py:468` |
| POST | `/api/v1/support/admin/submissions/{submission_id}/messages` | `require_admin_section('support')` | owner, admin, support | `support.py:508` |
| POST | `/api/v1/support/contact` | `get_current_user_optional` | public (identity used if present) | `support.py:132` |
| GET | `/api/v1/support/me/submissions` | `get_current_user` | any authenticated | `support.py:185` |
| POST | `/api/v1/support/me/submissions` | `get_current_user` | any authenticated | `support.py:194` |
| GET | `/api/v1/support/me/submissions/{submission_id}` | `get_current_user` | any authenticated | `support.py:230` |
| POST | `/api/v1/support/me/submissions/{submission_id}/messages` | `get_current_user` | any authenticated | `support.py:246` |
| GET | `/api/v1/taxes/admin/groups` | `require_admin` | owner, admin | `taxes.py:22` |
| POST | `/api/v1/taxes/admin/groups` | `require_admin` | owner, admin | `taxes.py:30` |
| DELETE | `/api/v1/taxes/admin/groups/{group_id}` | `require_admin` | owner, admin | `taxes.py:68` |
| PATCH | `/api/v1/taxes/admin/groups/{group_id}` | `require_admin` | owner, admin | `taxes.py:47` |
| PUT | `/api/v1/taxes/admin/groups/{group_id}/rates` | `require_admin` | owner, admin | `taxes.py:83` |
| DELETE | `/api/v1/taxes/admin/groups/{group_id}/rates/{country_code}` | `require_admin` | owner, admin | `taxes.py:104` |
| GET | `/api/v1/theme` | `(none)` | public | `theme.py:49` |
| GET | `/api/v1/theme/draft` | `require_admin_section('theme')` | owner, admin, content | `theme.py:62` |
| PUT | `/api/v1/theme/draft` | `require_admin_section('theme')` | owner, admin, content | `theme.py:91` |
| GET | `/api/v1/theme/preview` | `(none)` | public | `theme_preview.py:217` |
| POST | `/api/v1/theme/preview-token` | `require_admin_section('theme')` | owner, admin, content | `theme_preview.py:173` |
| POST | `/api/v1/theme/publish` | `require_admin_section('theme')` | owner, admin, content | `theme.py:107` |
| POST | `/api/v1/theme/reset-to-default` | `require_admin_section('theme')` | owner, admin, content | `theme.py:135` |
| POST | `/api/v1/theme/rollback/{version}` | `require_admin_section('theme')` | owner, admin, content | `theme.py:122` |
| GET | `/api/v1/theme/usage` | `require_admin_section('theme')` | owner, admin, content | `theme_usage.py:27` |
| GET | `/api/v1/theme/versions` | `require_admin_section('theme')` | owner, admin, content | `theme.py:76` |
| GET | `/api/v1/wishlist` | `require_complete_profile` | any authenticated + complete profile | `wishlist.py:14` |
| DELETE | `/api/v1/wishlist/{product_id}` | `require_complete_profile` | any authenticated + complete profile | `wishlist.py:37` |
| POST | `/api/v1/wishlist/{product_id}` | `require_complete_profile` | any authenticated + complete profile | `wishlist.py:23` |


---

## EVIDENCE

1. **Global auth bucket — executed lockout.** Command:
   `for i in $(seq 1 22); do curl -s -o /dev/null -w "%{http_code} " -X POST
   http://localhost:4202/api/v1/auth/login -H 'Content-Type: application/json'
   -d '{"email":"attacker-s1@example.com","password":"wrong"}'; done` →
   `401 401 401 401 401 401 401 401 401 401 401 401 401 401 401 401 401 401 401 401 401 429`.
   Immediately after — valid owner login: `HTTP 429`; valid unrelated customer login: `HTTP 429`.
   Code: `backend/app/core/rate_limit.py:91-101` (`identifier="global"`),
   `backend/app/api/v1/auth.py:106-115`, `backend/app/core/config.py:180-183`.

2. **`support` locks an `admin` — executed.**
   `PATCH /api/v1/admin/dashboard/users/4ee8445a-…/security` with a `support`-role bearer,
   body `{"locked_until":"2027-01-01T00:00:00Z","locked_reason":"s1-authz probe",
   "password_reset_required":true}` → `HTTP 200`, response
   `{… "role":"admin","locked_until":"2027-01-01T00:00:00Z","password_reset_required":true}`.
   Target admin login afterwards → `{"detail":"Account temporarily locked"} HTTP 403`.
   Control, same token vs the owner → `{"detail":"Cannot modify owner security settings"} HTTP 400`.
   Code: `backend/app/api/v1/admin_dashboard.py:4540-4562` (owner-only exclusion),
   `backend/app/core/dependencies.py:49` (`"users": {owner, admin, support}`).
   State restored: target unlocked and all three probe accounts demoted to `customer` (4 × HTTP 200).

3. **IP allowlist call-site asymmetry.**
   `grep -rn "_require_admin_ip_access" backend/app --include=*.py` →
   `app/core/dependencies.py:130:def _require_admin_ip_access(...)` and
   `app/core/dependencies.py:382:        _require_admin_ip_access(request, user)` — one definition,
   one call, inside `require_admin_section._dep` only. `require_admin` = `dependencies.py:345-356`,
   `require_owner` = `:389-400`. Affected route count 34 = 32 `require_admin` + 2 `require_owner`
   (see §B).

4. **`content` role reaches dashboard aggregates — executed.** With a `content`-role bearer:
   `200 GET /api/v1/admin/dashboard/users?limit=2` · `200 /admin/dashboard/orders` ·
   `200 /admin/dashboard/summary` · `200 /admin/dashboard/search?q=a` · `200 /admin/dashboard/funnel` ·
   `200 /admin/dashboard/channel-breakdown` · `200 /admin/dashboard/refunds-breakdown` ·
   `403 /admin/dashboard/users/search?q=owner` · `403 /orders/admin` · `403 /admin/dashboard/export`.
   Leaked body sample (emails masked, usernames/roles not):
   `[{"email":"a********@local.test","username":"audit-admin", … "role":"admin"}, …]`.
   Code: `admin_dashboard.py:2511,2545` vs `:2574,2882`; `services/pii.py:17-38`.

5. **Unauthenticated control probes (no defect).** `curl` with no `Authorization` header:
   `401` on `/admin/dashboard/summary`, `/admin/dashboard/export`, `/admin/dashboard/users`,
   `/orders/admin`, `/taxes/admin/groups`, `/fx/admin/status`, `/support/admin/submissions`,
   `/email-preview`; `403` on `/content/admin/home/preview` and `…?token=` (empty token rejected —
   `content.py:2343` plus the random per-process dev default at `config.py:299-309` and the
   production startup gate at `startup_checks.py:39`).

6. **Non-constant-time secret compares.** `backend/app/core/dependencies.py:118`
   (`header_value == bypass_secret`), `backend/app/api/v1/content.py:2343`
   (`token != settings.content_preview_token`), `backend/app/middleware/backpressure.py:87`
   (`request.headers.get("X-Maintenance-Bypass") == bypass_token`), vs the correct
   `backend/app/services/media_dam.py:485` (`hmac.compare_digest`).

7. **XFF append vs strip.** `backend/app/core/dependencies.py:107-109` (`raw.split(",", 1)[0]`);
   `infra/ssr-edge.conf:19` (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`);
   `docs/PRODUCTION.md:167` (documented mitigation); `infra/prod/docker-compose.yml:82-93`
   (`--proxy-headers --forwarded-allow-ips`, which does not cover the raw-header read).

8. **Matrix provenance.** 468 rows enumerated by AST over
   `backend/app/api/v1/*.py` (router-level + decorator + signature `Depends`), prefixes resolved
   from `app/api/v1/routes.py:44-71` and `app/main.py:89` (`prefix="/api/v1"`, no nesting).
   Per-file counts: admin_dashboard 65, content 72, auth 62, orders 59, catalog 54, coupons_v2 26,
   blog 21, support 17, ops 15, returns 9, cart 7, theme 7, fx 6, routes 6, taxes 6, notifications 5,
   payments 5, addresses 4, newsletter 4, shipping_admin 3, wishlist 3, admin_ui 2, analytics 2,
   shipping 2, theme_preview 2, email_preview 1, legal 1, observability 1, theme_usage 1.

SUCCESS:S1-authz-matrix 468 routes mapped; 3×P1 (global auth rate-limit lockout — executed; support-locks-admin privilege inversion — executed; require_admin/require_owner skip the admin IP allowlist), 3×P2, 1×P3; no unauthenticated state-changing hole and no IDOR found.
