import { TicketsComponent } from './tickets.component';

/** Tip orphan mint — statusPillClass default (2026-09-07T09:05:48Z). */
describe('TicketsComponent statusPillClass default helpers (golden WU)', () => {
  function bare(): TicketsComponent {
    return Object.create(TicketsComponent.prototype) as TicketsComponent;
  }
  it('default status uses slate classes', () => {
    expect(bare().statusPillClass('open')).toContain('slate');
  });
});
