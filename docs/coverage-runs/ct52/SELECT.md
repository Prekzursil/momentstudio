# Ct52 Select — contact submit UI arms

Contact already has service-level submit specs (`contact.component.spec.ts` +
`contact.component.extra.spec.ts`). N=3 NEW template/DOM arms:

1. Required-field validation disables the submit CTA until the form is valid
2. Successful submit paints the success banner and clears a prior error
3. Captcha-missing keeps submit disabled (honeypot/bot-adjacent gate) + failure paints the error banner / busy sending label

Spec: `frontend/src/app/pages/contact/contact.component.submit-ui.spec.ts`

Branch: cursor/golden-wu-contact-submit-coverage-4739
