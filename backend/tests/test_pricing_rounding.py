from decimal import Decimal

from app.services import pricing


def test_quantize_money_rounding_modes() -> None:
    assert pricing.quantize_money(Decimal("1.005"), rounding="half_up") == Decimal("1.01")
    assert pricing.quantize_money(Decimal("1.005"), rounding="half_even") == Decimal("1.00")
    assert pricing.quantize_money(Decimal("1.015"), rounding="half_even") == Decimal("1.02")
    assert pricing.quantize_money(Decimal("1.001"), rounding="up") == Decimal("1.01")
    assert pricing.quantize_money(Decimal("1.009"), rounding="down") == Decimal("1.00")


def test_compute_totals_respects_rounding_mode() -> None:
    breakdown = pricing.compute_totals(
        subtotal=Decimal("1.005"),
        discount=Decimal("0.00"),
        shipping=Decimal("0.00"),
        fee_enabled=False,
        fee_type="flat",
        fee_value=Decimal("0.00"),
        vat_enabled=False,
        vat_rate_percent=Decimal("0.00"),
        vat_apply_to_shipping=False,
        vat_apply_to_fee=False,
        rounding="down",
    )
    assert breakdown.subtotal == Decimal("1.00")
