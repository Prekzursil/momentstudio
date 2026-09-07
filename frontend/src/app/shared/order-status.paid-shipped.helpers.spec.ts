import { orderStatusChipClass } from './order-status';
describe('orderStatusChipClass paid/shipped tip (golden WU)', () => {
  it('maps paid and shipped', () => {
    expect(orderStatusChipClass('paid')).toContain('indigo');
    expect(orderStatusChipClass('shipped')).toContain('violet');
  });
});
