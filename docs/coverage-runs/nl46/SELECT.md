# Nl46 Select — newsletter unsubscribe submit arms

No `newsletter.component.ts` exists (confirm + unsubscribe pages only; subscribe UI is blog/CMS).
N=3 first specs target `NewsletterUnsubscribeComponent` (explicit submit CTA):

1. ngOnInit missing-token validation (no API call)
2. unsubscribe success path (loading cleared, success=true)
3. unsubscribe error detail + busy/success re-entry guards

Spec path (task template name): `frontend/src/app/pages/newsletter/newsletter.component.spec.ts`

Branch: cursor/golden-wu-newsletter-submit-coverage-4739
