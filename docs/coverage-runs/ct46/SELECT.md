# Ct46 Select — whitespace preview + FB initials + empty-title h1

Contact Istanbul is already maxed; N=3 assertion-gap arms (spec-only):

1. Whitespace-only preview token → trim falsy → public `/content/pages/contact` (not `/preview`)
2. Facebook page without `thumbnail_url` → `#facebookAvatar` initials (symmetric to IG-empty)
3. Empty/falsy `block().title` on success → h1 falls back to `contact.title` translate

Source packet: `/tmp/CONTACT45_SELECT.md` (contact45/46 same arms).
Exclude: #749 submit CTA / submit-ui arms.

Spec: `frontend/src/app/pages/contact/contact.component.extra.spec.ts`

Branch: cursor/golden-wu-contact-preview-fb-title-coverage-4739
