import { orderStatusChipClass } from './order-status';

describe('orderStatusChipClass', () => {
  it('returns the mapped class for each known status', () => {
    expect(orderStatusChipClass('pending')).toContain('amber');
    expect(orderStatusChipClass('pending_payment')).toContain('amber');
    expect(orderStatusChipClass('pending_acceptance')).toContain('sky');
    expect(orderStatusChipClass('paid')).toContain('indigo');
    expect(orderStatusChipClass('shipped')).toContain('violet');
    expect(orderStatusChipClass('delivered')).toContain('emerald');
    expect(orderStatusChipClass('cancelled')).toContain('rose');
    expect(orderStatusChipClass('refunded')).toContain('slate');
  });

  it('falls back to the refunded style for unknown statuses', () => {
    expect(orderStatusChipClass('unknown-status')).toBe(orderStatusChipClass('refunded'));
    expect(orderStatusChipClass('')).toBe(orderStatusChipClass('refunded'));
  });

  it('coerces non-string input via String()', () => {
    expect(orderStatusChipClass(null as unknown as string)).toBe(orderStatusChipClass('refunded'));
    expect(orderStatusChipClass(undefined as unknown as string)).toBe(
      orderStatusChipClass('refunded'),
    );
  });
});
