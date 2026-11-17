# SELECT — cart clear / promo / deliveryType leftovers

N=3 (avoid #742 quote/qty/stock and #761 deliveryEstimate/displayProductPrice):

1. `setDeliveryType` — updates type + `saveDeliveryPrefs`
2. `clearPromo` — resets promo fields + `loadFromBackend`
3. `clearCart` — confirm cancel vs confirm clear + reset

Branch: `cursor/golden-wu-cart-clear-promo-delivery-helpers-coverage-4739`
