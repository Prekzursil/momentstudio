import { TicketsComponent } from './tickets.component';
/** Tip orphan — statusPillClass (2026-09-07T09:34:23Z). */
describe('TicketsComponent statusPillClass pill-default (golden WU)', () => {
  it('resolved uses emerald', () => {
    const cmp = Object.create(TicketsComponent.prototype) as TicketsComponent;
    expect(cmp.statusPillClass('resolved')).toContain('emerald');
  });
});
