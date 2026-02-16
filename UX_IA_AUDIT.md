- If routes change, both templates must be updated independently (DRY violation)
- Account nav links also appear in header user menu dropdown (lines 146-184 in header.component.ts)

**Fix:**
- Keep desktop sidebar (better UX for desktop)
- Keep mobile dropdown (simpler for mobile)
- BUT: Generate both from a **single source of truth** (shared `AccountNavItem[]` array in a service)
- Remove redundant account links from header dropdown (Profile, Orders, Wishlist, Coupons) — they're already in account shell

**Effort:** M (extract to shared nav config)
**Impact:** 4/5 (reduces maintenance burden, prevents drift)

---

### **4. Header: Competing Overlay Menus**
**Issue:** Unclear Naming / Broken-Looking UI
**Evidence:**
- `/layout/header.component.ts:196-293` — Notifications dropdown
- `/layout/header.component.ts:129-195` — User menu dropdown
- `/layout/header.component.ts:356-381` — Mobile search overlay
- `/layout/header.component.ts:382-393` — Mobile nav drawer

**Why:**
- Four separate overlays, each with different backdrop behavior:
  - User menu: z-50 dropdown, closes on backdrop click (line 355)
  - Notifications: z-50 dropdown, closes on backdrop click (line 355)
  - Search: z-50 full-screen modal with backdrop blur
  - Nav drawer: z-140 slide-in with backdrop blur
- Inconsistent z-index layering (50 vs 110 vs 140) suggests accumulated fixes rather than planned hierarchy
- Opening one overlay doesn't always close others correctly (manual close logic scattered across multiple methods)

**Fix:**
- Unified overlay manager service to handle stacking context
- Single backdrop component with configurable blur/opacity
- Consistent z-index ladder:
  - `z-[100]` header
  - `z-[110]` dropdowns (user menu, notifications)
  - `z-[120]` backdrop
  - `z-[130]` modal search
  - `z-[140]` slide-in drawer

**Effort:** M (create overlay service, refactor close logic)
**Impact:** 3/5 (improves polish, reduces edge-case bugs)

---

### **5. Admin Sidebar: Preferences vs Settings Confusion**
**Issue:** Unclear Naming
**Evidence:**
- `/admin/admin-layout.component.ts:116-223` — "Preferences" section in sidebar
  - Contains: Compact Sidebar toggle, UI Preset (owner_basic/custom), UI Mode (simple/advanced), Training Mode toggle
- `/admin/content/admin-content-layout.component.ts:35-186` — Content workspace toolbar
  - Contains: Editor Mode, Preview Device, Preview Layout, Preview Language, Preview Theme

**Why:**
- **Admin sidebar** calls these "Preferences"
- **Content toolbar** calls these "Workspace" settings (but they're also preferences)
- Users must remember two different places for similar concepts (UI customization)
- No clear rule for "What lives in sidebar vs toolbar?"

**Fix:**
- **Sidebar Preferences:** Global admin UI settings (mode, preset, compact, training)
- **Toolbar/Page Settings:** Context-specific settings (content preview, language, theme *for previewing*)
- Add a hint/tooltip on first use: "Preview settings apply only to content preview"

**Effort:** S (add clarifying text/tooltips)
**Impact:** 3/5 (reduces "where is that setting?" confusion)

---

### **6. Dark Mode Contrast Issues in Notifications Dropdown**
**Issue:** Low Contrast
**Evidence:**
- `/layout/header.component.ts:237-273` — Notification cards inside dropdown
- Line 240: `bg-amber-50/70 dark:bg-amber-950/25` — Unread notification background
- Line 240: `dark:bg-amber-950/25` is only 25% opacity, very subtle in dark mode

**Why:**
- Unread notifications should be visually distinct, but the dark mode background is too subtle
- The amber tint at 25% opacity barely differentiates from read notifications on dark slate background
- This makes it hard to scan for new notifications quickly

**Fix:**
- Increase dark mode unread background opacity: `dark:bg-amber-950/40` or use solid `dark:bg-amber-900/30`
- OR: Add a stronger border: `dark:border-amber-700` instead of `dark:border-slate-800`

**Effort:** S (adjust Tailwind classes)
**Impact:** 2/5 (improves scannability for authenticated users)

---

### **7. Admin Dashboard: Multiple "Refresh" Actions Without Hierarchy**
**Issue:** Redundant Controls
**Evidence:**
- Admin dashboard (implied from context, not directly read but referenced in admin-layout alerts refresh button)
- `/admin/admin-layout.component.ts:228-236` — Alerts section has a refresh button
- Alerts auto-refresh every 5 minutes (line 519)

**Why:**
- Alerts section has both: (1) auto-refresh timer, (2) manual refresh button
- If dashboard has widget-level refresh + global refresh, users don't know which to use
- The alerts refresh button (line 232) is visually identical to alert items below it (same size, same rounded style)

**Fix:**
- Remove manual alerts refresh button (auto-refresh is sufficient)
- OR: Make refresh icon subtle (ghost button, lower contrast) to deprioritize vs alerts themselves

**Effort:** S (remove button or adjust styling)
**Impact:** 2/5 (reduces visual noise in sidebar)

---

### **8. Mobile Account Dropdown: Asymmetric Placement**
**Issue:** Broken-Looking UI
**Evidence:**
- `/account/account.component.ts:92-116` — Mobile dropdown select
- Located ABOVE the main content grid (lines 92-116), separate from desktop sidebar (lines 118-216)
- On mobile, you see: dropdown → then main content below
- On desktop, you see: sidebar (left) | main content (right)

**Why:**
- The dropdown is visually disconnected from the content below (no border, no background linking them)
- It looks like a "filter" control rather than navigation
- The "Help Center" link is INSIDE the dropdown card (line 115) but outside the `<select>` — inconsistent

**Fix:**
- Wrap dropdown + main content in a shared card/border on mobile to show they're related
- OR: Move Help Center link outside dropdown card (below it) for symmetry

**Effort:** S (adjust template structure)
**Impact:** 2/5 (improves perceived quality on mobile)

---

### **9. Nested Scrollbars in Admin Sidebar**
**Issue:** Weird Spacing
**Evidence:**
- `/admin/admin-layout.component.ts:77-84` — Aside element
- Line 78: `lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto`
- Sidebar is sticky with max-height calculation, can scroll independently

**Why:**
- On pages with long content, you get TWO scrollbars: (1) page scroll, (2) sidebar scroll
- This violates "one scrollbar per viewport" heuristic
- The `calc(100vh-8rem)` assumes header height, but if header changes, this breaks

**Fix:**
- Make sidebar `position: sticky` with `top: 24` (6rem, assuming header ~4rem + 2rem spacing)
- Remove `overflow-y-auto`; let page scroll handle everything
- OR: Use `position: fixed` sidebar with full-height scroll (like typical admin dashboards)

**Effort:** M (test across breakpoints, adjust layout)
**Impact:** 3/5 (improves scrolling UX, feels more polished)

---

### **10. Theme/Language Controls in Three Places**
**Issue:** Disconnected Implementations
**Evidence:**
- `/layout/header.component.ts:294-316` — Desktop header (theme + language inline)
- `/shared/nav-drawer.component.ts` (referenced but not read) — Mobile drawer has same controls
- `/admin/content/admin-content-layout.component.ts:159-185` — Content preview theme selector

**Why:**
- Header controls change **global** theme/language
- Content preview controls change **preview-only** theme/language (for previewing pages)
- Both use similar UI (segmented controls), easy to confuse
- If user changes theme in header while editing content, the preview theme may not update (they're separate)

**Fix:**
- Clearly label content preview controls: "Preview in Light/Dark" (not just "Light/Dark")
- Add a reset button in content preview: "Use My Theme" to sync with global setting
- OR: Remove preview theme control, always use user's current theme (simpler)

**Effort:** M (sync logic or add reset button)
**Impact:** 3/5 (prevents "why didn't theme change?" confusion)

---

## Surface Boundary Proposal

### **Storefront Shell**
**Belongs:**
- Browse & discover (home, shop, blog, products)
- Add to cart, checkout
- Public content (about, contact, pages)
- Auth flows (login, register, password reset)

**Does NOT Belong:**
- Account management (move to Account shell)
- Admin tools (move to Admin shell)

**Key Rule:** Storefront = pre-purchase discovery + purchase flow. Post-purchase = Account.

---

### **Account Shell**
**Belongs:**
- Profile & identity (profile, security, privacy)
- Order history & tracking
- Saved items (wishlist, coupons)
- Communication (notifications, comments, tickets)
- Addresses & billing

**Does NOT Belong:**
- Store management (products, inventory, orders) → Admin
- Content editing (blog, pages, media) → Admin

**Key Rule:** Account = "my stuff as a customer." Admin = "managing the business."

**Special Case:** Help Center (`/tickets`) is currently a separate route but feels like it belongs IN the Account shell (as a subnav item). Consider moving it to `/account/tickets` or clarifying why it's separate.

---

### **Admin Shell**
**Belongs:**
- Store operations (orders, returns, inventory)
- Catalog management (products, coupons)
- Content authoring (blog, pages, media)
- Customer data (users, segments, GDPR)
- Support & ops (tickets, webhooks, emails)
- System config (settings, permissions)

**Does NOT Belong:**
- Personal account settings (profile, security) → Account shell
- Shopping/browsing (products as a customer) → Storefront

**Key Rule:** Admin = business management. Requires elevated permissions.

**Sub-Shell Rule:** Content editor (`/admin/content/*`) is a **sub-shell** with its own toolbar. This is acceptable IF the toolbar is simplified (see Issue #1).

---

### **Shell Transition Rules**
1. **Storefront → Account:** User logs in → header shows account dropdown + notifications bell
2. **Account → Admin:** "View Admin" link in navigation IF user has staff role
3. **Admin → Storefront:** "Edit Mode" toggle in storefront nav (admin-only) to preview changes
4. **Any → Auth:** Logout clears session, redirects to storefront home

---

## Control Surface Rules (Per Page Type)

### **Storefront Pages**
**Primary Job:** Browse, discover, purchase
**Top 1-3 Actions:**
1. Search (always visible in header)
2. Add to Cart (on product pages)
3. View Cart (always visible as cart icon badge)

**What Moves to Overflow/Settings:**
- Theme/Language (already in header, keep there)
- Newsletter signup (footer)
- Footer links (terms, privacy, social)

**Rule:** Storefront header = minimal. Focus on search + cart + account access.

---

### **Account Pages**
**Primary Job:** Manage personal data, view orders, track issues
**Top 1-3 Actions (per subpage):**
- **Overview:** Quick links to orders, wishlist, coupons
- **Profile:** Edit profile, Verify email
- **Orders:** Filter/search orders, View order details
- **Addresses:** Add/edit address
- **Wishlist:** Remove items, Add to cart
- **Notifications:** Mark read, Dismiss, Settings link

**What Moves to Overflow/Settings:**
- Privacy controls (separate Privacy page, OK)
- Password change (separate Security page, OK)
- Help Center (link at bottom of nav, OK)

**Rule:** Each account page has ONE primary action (edit/add/filter). Secondary actions in page body.

---

### **Admin Pages**
**Primary Job:** Varies by page (view data, edit content, manage operations)

#### **Admin Dashboard**
**Top 1-3 Actions:**
1. Global search (Cmd+K)
2. Refresh all widgets
3. Jump to key sections (via keyboard shortcuts)

**What Moves to Overflow/Settings:**
- Time range selector (per widget, not global)
- Filters (per widget, not global)

**Rule:** Dashboard = overview. Keep global actions at top, widget-specific actions inside widgets.

---

#### **Admin Orders**
**Top 1-3 Actions:**
1. Filter by status/date/search
2. Bulk actions (export, mark shipped)
3. View order detail (click row)

**What Moves to Overflow/Settings:**
- Saved filter presets (dropdown in filter bar)
- Column visibility (table settings icon)
- Export format options (inside Export modal)

**Rule:** Filter bar + action buttons at top. Table below. No more than 2 rows of controls.

---

#### **Admin Products**
**Top 1-3 Actions:**
1. Add new product
2. Search/filter products
3. Bulk edit (select multiple → action bar appears)

**What Moves to Overflow/Settings:**
- Category management (separate modal/page)
- Image bulk upload (inside image manager modal)
- Archive/delete (inside row dropdown menu)

**Rule:** Sticky action bar appears only when items selected. Otherwise, minimal top toolbar.

---

#### **Admin Content (Sub-Shell)**
**Top 1-3 Actions:**
1. Switch section (Home/Pages/Blog/Scheduling/Media/Settings) via tab nav
2. Edit content (primary job)
3. Preview content (secondary job)

**What Moves to Overflow/Settings:**
- **MOVE:** Preview Device, Layout, Language, Theme → Collapsible "Preview Settings" panel (Issue #1)
- **KEEP:** Editor Mode (Simple/Advanced) — affects editing behavior, keep visible

**Rule:** Content editor = writing focus. Preview settings are secondary, hide by default.

---

### **Cross-Shell Control Consistency**
**Pattern:** Page Header + Primary Actions + Content Area + Optional Sticky Footer
**Example:**
```
┌─────────────────────────────────────┐
│ Breadcrumb / Page Title             │  ← Page Header
│ [Primary Action] [Secondary] [...]  │  ← Action Bar
├─────────────────────────────────────┤
│                                     │
│          Content Area               │
│                                     │
└─────────────────────────────────────┘
```

**Avoid:**
- Two rows of action buttons (consolidate or use tabs)
- Action buttons BELOW content (use sticky footer if needed)
- Mixing tabs + pills + buttons in one row (pick one pattern)

---

## Implementation Recommendations

### **Quick Wins (1-2 days, High Impact)**
1. Collapse content editor preview settings (Issue #1)
2. Remove admin alerts refresh button (Issue #7)
3. Increase dark mode notification contrast (Issue #6)
4. Add clarifying labels to preview controls (Issue #5)

### **Medium Effort (3-5 days)**
5. Refactor admin sidebar favorites (Issue #2)
6. Extract account nav to shared config (Issue #3)
7. Unify overlay z-index hierarchy (Issue #4)
8. Fix mobile account dropdown layout (Issue #8)

### **Longer-Term (1-2 weeks)**
9. Refactor admin sidebar scrolling (Issue #9)
10. Sync global theme with content preview theme (Issue #10)

---

## Conclusion

The AdrianaArt platform has a solid technical foundation but suffers from **incremental feature additions without UX consolidation**. The most impactful improvements are:

1. **Simplify admin content toolbar** (highest ROI)
2. **Reduce navigation redundancy** (admin sidebar, account nav)
3. **Clarify settings vs preferences** (admin vs content)

**Next Steps:**
1. Prioritize Quick Wins for immediate polish
2. Design spec for unified control patterns
3. Conduct usability testing with current admin users to validate Issues #1, #2, #5

---

**Appendix: Files Analyzed**
- `/frontend/src/app/app.routes.ts` (route definitions)
- `/frontend/src/app/app.component.ts` (root shell)
- `/frontend/src/app/layout/header.component.ts` (storefront header)
- `/frontend/src/app/pages/admin/admin-layout.component.ts` (admin shell)
- `/frontend/src/app/pages/admin/content/admin-content-layout.component.ts` (content sub-shell)
- `/frontend/src/app/pages/account/account.component.ts` (account shell)
- Plus ~115 other component files explored via code analysis tools
# Weekly UX/IA + Correctness Audit (2026-02-16)

## Top 10 Highest-Impact Issues
1) Issue: Global footer change-detection failure (NG0100) fires on storefront/account/admin routes, including the error fallback.
   - Evidence: artifacts/console-errors.json (routes `/`, `/contact`, `/error`, `/admin/gdpr`, `/**`), frontend/src/app/layout/footer.component.ts:1-340.
   - Why: ExpressionChangedAfterItHasBeenCheckedError is thrown before paint, risking broken renders and masking real errors across every surface.
   - Fix: Move subscription-driven state mutations to `ngAfterViewInit` and trigger `cdr.markForCheck()`/`detectChanges()` before exiting async callbacks; avoid mutating `openMenu` during the same change detection tick.
   - Effort: M
   - Impact: 5

2) Issue: Shop and category pages throw HttpErrorResponse, blocking catalog discovery.
   - Evidence: artifacts/deterministic-findings.json (entries for `/shop` and `/shop/:category`), artifacts/console-errors.json (route `/shop`), artifacts/screenshots/shop.png.
   - Why: The primary product browse flow fails, stopping shoppers before they reach PDP or cart.
   - Fix: Harden CatalogService calls with retry + offline empty-state, and gate rendering on resolved data so the page degrades with a friendly fallback instead of an uncaught HttpErrorResponse.
   - Effort: M
   - Impact: 4

3) Issue: Product detail page renders without an H1 and emits a homepage canonical, diluting SEO equity.
   - Evidence: artifacts/seo-snapshot.json (route `/products/:slug`, `h1_count: 0`, canonical `https://momentstudio.ro/`), frontend/src/app/pages/product/product.component.ts:760-806.
   - Why: Search engines see duplicate canonicals and no primary heading, weakening organic relevance for each product.
   - Fix: Render a visible H1 with the product name and ensure `setLocalizedCanonical` resolves to `/products/{slug}` for both SSR and client runs.
   - Effort: M
   - Impact: 4

4) Issue: Newsletter confirmation page has no H1, hurting accessibility and clarity even though it is noindex.
   - Evidence: artifacts/seo-snapshot.json (route `/newsletter/confirm`, `h1_count: 0`, screenshot `artifacts/screenshots/newsletter-confirm.png`).
   - Why: Screen readers lack a page landmark and users lack a clear confirmation headline.
   - Fix: Add a concise H1 like “Newsletter confirmed” aligned with the confirmation copy.
   - Effort: S
   - Impact: 3

5) Issue: Newsletter unsubscribe page also lacks an H1.
   - Evidence: artifacts/seo-snapshot.json (route `/newsletter/unsubscribe`, `h1_count: 0`, screenshot `artifacts/screenshots/newsletter-unsubscribe.png`).
   - Why: Users unsubscribing get no top-level heading; assistive tech misses the page purpose.
   - Fix: Add an H1 describing the unsubscribe state and any next steps.
   - Effort: S
   - Impact: 3

6) Issue: Checkout and payment return/cancel routes log LCP warnings because the brand image is lazy-loaded.
   - Evidence: artifacts/deterministic-findings.json (routes `/checkout`, `/checkout/paypal/return`, `/checkout/stripe/return`, `/checkout/success`), artifacts/console-errors.json (NG0913 warning referencing `assets/brand/made-by-andrei-visalon-light.png`), frontend/src/app/layout/footer.component.ts:274-302.
   - Why: LCP penalties on the checkout shell slow a conversion-critical flow and inflate Core Web Vitals risk.
   - Fix: Mark the brand image `priority`/`loading="eager"` via `NgOptimizedImage` and swap to a lighter inline SVG for the footer logo on checkout surfaces.
   - Effort: S
   - Impact: 3

7) Issue: Account child routes do not declare noindex, exposing private surfaces to indexing if crawled directly.
   - Evidence: artifacts/route-map.json (account children such as `/account/addresses` and `/account/orders` show `robots_hint: null`), frontend/src/app/app.routes.ts:186-240.
   - Why: Auth-only pages risk being indexed or cached by search engines, leaking metadata and creating broken entry points.
   - Fix: Apply `data: { robots: NOINDEX_ROBOTS }` on each account child or ensure the meta resolver inherits and emits the parent robots tag for all descendants.
   - Effort: S
   - Impact: 4

8) Issue: Admin content shell stacks five equally-weighted segmented controls in one toolbar row.
   - Evidence: artifacts/screenshots/admin-content.png, frontend/src/app/pages/admin/content/admin-content-layout.component.ts:35-186.
   - Why: Editor Mode, Device, Layout, Language, and Theme all compete as primary actions, crowding the viewport and delaying content focus.
   - Fix: Keep Editor Mode visible, move Preview controls into a “Preview options” popover, and persist the last selection per user.
   - Effort: M
   - Impact: 4

9) Issue: Admin sidebar duplicates navigation via Favorites section plus star icons on every item.
   - Evidence: frontend/src/app/pages/admin/admin-layout.component.ts:116-346, artifacts/screenshots/admin.png.
   - Why: Users see two parallel nav systems (favorites list and starred main list), increasing scanning time and maintenance overhead.
   - Fix: Show favorites inline as badges within the main list or remove inline stars when the Favorites block is visible; hide Alerts when empty to reduce vertical clutter.
   - Effort: M
   - Impact: 3

10) Issue: Account shell renders both a mobile select and a desktop sidebar simultaneously.
    - Evidence: frontend/src/app/pages/account/account.component.ts:92-216, artifacts/screenshots/account.png.
    - Why: Two parallel navigation implementations increase code paths and risk state drift between viewports.
    - Fix: Drive both layouts from a single nav model with a shared selection state, rendering only the relevant control per breakpoint.
    - Effort: M
    - Impact: 3

## Surface Boundary Proposal
- Storefront shell: Public shopping, content marketing, blog, and checkout entry/returns; keep auth callbacks and receipt views here but protect them with clear status messaging.
- Account shell: Self-service profile, orders, addresses, notifications, security, comments, privacy, wishlist, coupons, and tickets; all routes should inherit noindex and avoid admin-only controls.
- Admin shell: Operational dashboards, catalog/inventory/orders/returns, coupons, users/segments/GDPR, ops/IP bypass, support, and the content editor sub-shell; no shopper-facing actions should appear here.

## Control Surface Rule Per Page Type
- Storefront pages — Primary job: help visitors discover and purchase products. Top actions: add to cart, proceed to checkout, apply filters/sort. Overflow: secondary preview toggles, social links, and admin edit shortcuts.
- Account pages — Primary job: let customers manage their data and orders. Top actions: update profile/address, view/reorder, manage notifications/security. Overflow: export data, delete account, and less-used preferences.
- Admin pages — Primary job: operate the business. Top actions: per-page primary CTA (e.g., publish content, fulfill order, adjust inventory). Overflow: filters, bulk actions beyond top 3, and preview/simulation toggles.
