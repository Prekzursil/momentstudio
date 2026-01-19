from decimal import Decimal

from app.models.cart import Cart, CartItem
from app.services import cart as cart_service


def test_decimal_totals_quantize():
    cart = Cart(id=None)  # type: ignore[arg-type]
    cart.items = [CartItem(unit_price_at_add=0.1, quantity=3)]
    totals = cart_service._calculate_totals(cart, shipping_fee_ron=Decimal("0.00"))  # type: ignore[arg-type]
    assert totals.subtotal == Decimal("0.30")
    assert totals.tax == Decimal("0.03")
    assert totals.total == Decimal("0.33")
