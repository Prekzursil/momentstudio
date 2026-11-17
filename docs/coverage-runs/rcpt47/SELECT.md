# Rcpt47 Select — receipt payment/status + load arms

N=3 first specs for `ReceiptComponent` (0 prior page specs):

1. paymentMethodLabel mapping (stripe/paypal/netopia/cod/unknown/empty)
2. missing-token empty/error state (no API; toggleReveal no-op)
3. token load + pdfUrl helper, API error detail/fallback, toggleReveal reload

Spec: `frontend/src/app/pages/receipt/receipt.component.spec.ts`

Branch: cursor/golden-wu-receipt-status-coverage-4739
