# Ct47 Select — IG thumbnail + admin edit DOM + tel/mailto hrefs

Contact Istanbul is already maxed; N=3 assertion-gap arms (spec-only).
Deferred from CONTACT45 after #753 (preview/FB/title) and excluding #749 submit UI.

1. Instagram page **with** `thumbnail_url` → `<img>` path (not `#instagramAvatar` initials); symmetric to #753 FB-empty
2. `canEditPage` true → admin edit button visible in DOM (`page.admin.edit`)
3. Social phone/email signals → `tel:` / `mailto:` card hrefs in DOM

Exclude: #753 whitespace preview / FB initials / empty-title h1; #749 submit CTA / captcha.

Spec: `frontend/src/app/pages/contact/contact.component.extra.spec.ts`

Branch: cursor/golden-wu-contact-ig-edit-href-helpers-coverage-4739
