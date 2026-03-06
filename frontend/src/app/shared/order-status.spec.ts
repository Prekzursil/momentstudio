import { orderStatusChipClass } from './order-status';

describe('orderStatusChipClass', () => {
  it('returns known style for known statuses', () => {
    expect(orderStatusChipClass('pending')).toContain('amber');
    expect(orderStatusChipClass('paid')).toContain('indigo');
    expect(orderStatusChipClass('delivered')).toContain('emerald');
  });

  it('falls back to refunded style for unknown status', () => {
    const fallback = orderStatusChipClass('not-real');
    expect(fallback).toContain('slate');
    expect(fallback).toContain('text-slate-700');
  });
});

