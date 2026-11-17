# checkout-coupon-payment-helpers SEAL — CONDITIONAL

- Spec: `frontend/src/app/pages/checkout/checkout-coupon-payment-helpers.arms.spec.ts`
- Target: describeCouponOffer, describeCouponReasons, isPaymentMethodAvailable
- INNER: **3 SUCCESS** (focused `ng test --include='**/checkout-coupon-payment-helpers.arms.spec.ts'`)
- N=3:
  1. `describeCouponOffer covers free_shipping, amount, missing promo, and zero savings`
  2. `describeCouponReasons joins translated and raw reasons`
  3. `isPaymentMethodAvailable gates methods by currency and enabled flags`
- `make verify`: **skipped** (per WU; INNER only)
- tip: `0d9b71cac182052bb16bd8f13eb5203cdc75ec30`

