# Chk55 Select — checkout step / address / shipping arms

Existing `checkout.component.spec.ts` and `guest-flow.spec.ts` cover placeOrder
submit paths only. Step enablement helpers, country normalize, and courier/delivery
guards were uncovered. N=3 NEW arms:

1. Step enablement — `step1Complete` guest create-account gates; `step2Complete` /
   `step3Complete` track missing name and locker-without-selection
2. Address validate — `normalizeShippingCountry` rejects invalid input and applies
   valid country codes
3. Shipping method guards — `setDeliveryType` / `setCourier` / `courierAllowed`
   reject unavailable locker/courier options

Spec: `frontend/src/app/pages/checkout/checkout.arms.spec.ts`

Branch: cursor/golden-wu-checkout-step-coverage-4739
