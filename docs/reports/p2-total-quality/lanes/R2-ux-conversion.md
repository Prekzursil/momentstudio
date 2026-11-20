# R2-ux-conversion — E-commerce UX + WCAG 2.2 AA specifics that change conversion

Lens: IDEATION (external sources) mapped onto this app. Read-only. Browser launch **withheld**
(box measured at 3.7 GB free / 221 node+chrome procs — a Chromium would freeze it), so
render-dependent items are labelled HYPOTHESIS with a named settling experiment. Static + SSR-HTML
(`curl`) evidence is labelled OBSERVED.

---

## P0-1 — Guest checkout is gated on an emailed **link** with no code field, no status re-poll, and no form persistence · almost-certain (90-99%)

**What.** `step2Complete()`/`placeOrder()` hard-block order placement until `guestEmailVerified`
(checkout.component.ts:698, 1755-1760). The UI only offers "send/resend" + "link sent"
(checkout-shipping-step.component.ts:319-360) — **no token input**, even though the email body
carries `Or use this token: {token}` (email.py:890-894), the binding `guestVerificationToken`
exists (checkout.component.ts:429), and `POST /orders/guest-checkout/email/confirm` accepts it
(orders.py:2259-2280). `loadGuestEmailVerificationStatus()` is called **once** (line 1964) — no
`visibilitychange`/`window:focus` re-check. `checkout-prefs.service.ts` persists only
courier/deliveryType/paymentMethod, so the address, name and phone are **not** persisted.

**Why/impact.** The shopper must leave checkout, open mail, click, and land back via a full
navigation (`next=/checkout`, verify-email.component.ts:93-117) that re-creates the component and
**discards every typed field**. If they instead return to the original tab, the UI still says
unverified. On mobile, an email app's in-app browser has a different guest `session_id`, so confirm
fails — the code already ships a `guestDeviceHint` dead-end for exactly this. Forced account
creation drives 26% of abandonments (Baymard); this is functionally equivalent friction on top of a
70.2% baseline. It is also a **WCAG 2.2 SC 3.3.7 Redundant Entry** failure: information entered
earlier in the same process is neither auto-populated nor available for selection.

**Fix.** (a) Add the token input next to Resend — `inputmode="numeric" autocomplete="one-time-code"`,
paste allowed (SC 3.3.8 requires paste + user-agent fill; typing-only is insufficient). Pure UI
work: endpoint + binding already exist. (b) Re-call `loadGuestEmailVerificationStatus()` on
`visibilitychange`. (c) Draft the guest address to `sessionStorage` on change. (d) Best: verify
**after** order placement, not before.

## P1-2 — Returning customers are hard-blocked out of guest checkout · almost-certain

`orders.py:2234-2238` raises 400 *"Email already registered; please sign in to checkout."* A
customer who forgot they had an account hits a wall mid-checkout with no inline recovery.
**Fix:** allow guest purchase on a known email and attach the order post-hoc, or render an inline
sign-in that preserves cart + typed form.

## P1-3 — PDP carries zero cost/trust information · almost-certain (OBSERVED)

Rendered `/products/white-cup` text between price and footer is: price, description, variant,
quantity, Add to cart, Back to shop. No delivery cost, no lead time, no 14-day withdrawal, no
returns, no payment badges. Unexpected extra costs = **48%** of abandonments (Baymard). It also
weakens EU CRD art. 6(1) pre-contractual disclosure at the decision point.
**Fix:** a compact strip under Add to cart — shipping cost / free-shipping threshold (the data
already exists in the cart quote), "delivery ~7 business days" (already in terms.en.md:115),
"14-day returns", Netopia/Visa/Mastercard icons (already an asset in the footer).

## P1-4 — Drag-only reordering, no pointer or keyboard alternative · almost-certain

HTML5 `draggable`+`dragstart` with no move-up/move-down and no `keydown` handler:
shop.component.ts:181-188 & 893-894 (storefront), product-image-manager-modal.component.ts:61-62,
cms-block-library.component.ts:83-84, admin-orders kanban `cdkDrag`:503. Fails **SC 2.5.7 Dragging
Movements** and **SC 2.1.1 Keyboard**. The correct pattern already exists in this codebase
(admin.component.ts:2575-2598, 5245-5268 `moveUp`/`moveDown`) — it just isn't applied everywhere.
**Fix:** reuse those buttons on every draggable list; size them ≥24×24 CSS px.

## P2-5 — Empty cart quotes Shipping 20.00 RON and Estimated total 20.00 RON · almost-certain (OBSERVED)

`/checkout` with 0 items renders "Your cart is empty" beside a 20 RON shipping line and a 20 RON
total. (Proceed-to-checkout is correctly `aria-disabled` — that part is right.)
**Fix:** suppress or dash the shipping/total rows when `items().length === 0`.

## P2-6 — SC 2.4.11 Focus Not Obscured risk from sticky chrome · likely (55-80%) · **HYPOTHESIS**

`sticky top-0 z-[100]` header (header.component.ts:49) with **no** global `scroll-padding-top`
(grep over `styles.css` + all templates: only per-container `scroll-mt-24`, never on fields). Also
`fixed inset-x-0 bottom-0 z-40` mobile bar (shop.component.ts:1014) and `sticky bottom-0` form bar
(address-form.component.ts:332). Tab-driven scrolling (not the app's own `scrollIntoView`) parks a
field flush at viewport top, under the header. **Settling experiment:** with a browser free, Tab
through `/checkout` at 1280×800 and 390×844 and assert every focused control's rect is fully
outside the sticky header/footer rects. **Fix:** `html { scroll-padding-top: 5rem;
scroll-padding-bottom: 5rem; }`.

## P2-7 — Guests see a promo field they cannot use · almost-certain (OBSERVED)

Coupon input and Apply render `disabled` with "Sign in to use coupons." A visible dead control reads
as broken and re-imposes the sign-in tax on anyone arriving from a coupon campaign.
**Fix:** enable guest redemption, or hide the block for guests.

## P2-8 — Form-error semantics exist only in checkout · almost-certain

`aria-invalid` occurs 14× in checkout-shipping-step, 1× in checkout.component, 1× in address-form —
and **nowhere else** (login, register, contact, tickets, all admin). `role="alert"` appears in 4
templates total. No error summary anywhere; recovery is `focusFirstInvalidField()` only.
**Fix:** extract the checkout field pattern (label + `aria-invalid` + `aria-describedby` + inline
message, validated on blur not on keystroke) into a shared `<app-field>`; add a GOV.UK-style error
summary with in-page links on submit failure.

## P2-9 — Field count roughly double the effective target · likely

29 `<input>` + 4 `<select>` in the shipping step alone. Baymard: effective checkouts run 7-8 fields;
the average is >14, and field reduction beats layout changes.
**Fix:** collapse `address-line2` behind "Add apartment/floor"; drop middle name
(`autocomplete="additional-name"`); derive city + county from the RO postal code; keep the
invoice/VAT block collapsed. Billing-same-as-shipping default is already correct (a 3.3.7 win).

## P3-10 — Dead EU ODR URL still printed; no model withdrawal form · likely

`anpc.en.md:24` (and `.ro`) still lists `https://ec.europa.eu/consumers/odr`. Reg. (EU) 2024/3228
killed the platform on 20 Jul 2025 and required traders to **remove** the link. The page does say
it's discontinued and points at `consumer-redress.ec.europa.eu`, so this is hygiene, not breach.
Separately, no **model withdrawal form** (Dir. 2011/83/EU Annex I(B)) exists in terms.en/ro.md.
**Fix:** delete the dead URL, keep the explanation; append the model form + a download link.

## P3-11 — SSR emits `<app-button role="none" tabindex="0">` · even (~50%) · **HYPOTHESIS**

Observed in the cart/checkout SSR payload, correlated with Angular's `jsaction` event-replay
attribute; the source host binding is `tabindex: '-1'` (button.component.ts:13-15). Pre-hydration
that is a focusable, role-less, name-less tab stop, and a duplicate stop once the inner control is
also focusable. **Settling experiment:** count tab stops on `/cart` with JS disabled vs after
hydration.

---

## Already satisfied (do not spend budget here)

Autocomplete tokens are good — `shipping|billing address-line1/level1/level2/postal-code/country`,
`given-name`, `family-name`, `email`, `tel-national`, `new-password`, `one-time-code` (2FA);
`autocomplete="off"` is used only on VAT-id, an address search box and a custom label (all
legitimate). `type="email"`/`type="tel"` + `inputmode="numeric"` on postal code give correct mobile
keyboards. Cart shows subtotal / shipping / estimated total **before** checkout plus a
free-shipping progress meter — the single strongest counter to the 48% extra-costs cause. Footer
carries name, registration no., CUI, address, phone, email (ANPC Order 225/2023) plus ANPC/SAL page
and payment badges with alt text. Skip-link and polite/assertive live regions are present in
checkout. Skeleton loaders and `*.empty` states exist across account/admin.

---

## EVIDENCE

- `frontend/src/app/pages/checkout/checkout.component.ts:698,1755-1760,1964` — verification hard
  gate; single non-polled status load.
- `frontend/src/app/pages/checkout/checkout-shipping-step.component.ts:319-360` — send/resend only,
  no token input; `backend/app/services/email.py:884-895` — email ships link **and** token.
- `frontend/src/app/core/checkout-prefs.service.ts:18-42` — persists courier/deliveryType/payment
  only (no address ⇒ SC 3.3.7).
- `backend/app/api/v1/orders.py:2234-2238` — 400 "Email already registered; please sign in".
- `curl http://localhost:4202/products/white-cup` → text between price and footer contains no
  shipping/returns/lead-time; `curl http://localhost:4202/checkout` → "Your cart is empty" +
  "Shipping 20.00 RON" + "Estimated total 20.00 RON" + "Sign in to use coupons."
- `frontend/src/app/pages/shop/shop.component.ts:181-188,893-894,1014`;
  `frontend/src/app/layout/header.component.ts:49`;
  `backend/alembic/seed_data/legal/anpc.en.md:24`.
- Baymard checkout usability (26% forced-account, 48% extra costs, 7-8 vs >14 fields):
  https://baymard.com/research/checkout-usability ·
  https://baymard.com/learn/checkout-flow-ux-optimization
- W3C WCAG 2.2 Understanding: https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html
  (paste/auto-fill mandatory) · .../target-size-minimum.html (24×24 + 5 exceptions) ·
  https://www.w3.org/TR/WCAG22/ (2.4.11, 2.5.7, 3.3.7)
- EU ODR shutdown / link-removal duty (Reg. (EU) 2024/3228, 20 Jul 2025):
  https://natlawreview.com/article/no-one-wants-dispute-consumers-end-european-online-dispute-resolution-platform-odr
- ANPC Order 225/2023 homepage disclosure duty:
  https://www.fiscal-requirements.com/news/2725

SUCCESS:R2-ux-conversion 11 findings (1 P0, 3 P1, 5 P2, 2 P3); headline = guest checkout blocked behind an email-link round trip that discards the typed address (SC 3.3.7 + conversion), fixable with an already-wired token field.
