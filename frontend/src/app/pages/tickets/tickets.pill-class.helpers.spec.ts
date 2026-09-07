import { TicketsComponent } from './tickets.component';

/** Tip orphan mint — TicketsComponent.statusPillClass (2026-09-07T07:36:38Z). */
describe('TicketsComponent statusPillClass pill-class helpers (golden WU)', () => {
  function bare(): TicketsComponent {
    return Object.create(TicketsComponent.prototype) as TicketsComponent;
  }

  it('maps resolved/triaged/default pill classes', () => {
    const cmp = bare();
    expect(cmp.statusPillClass('resolved')).toContain('emerald');
    expect(cmp.statusPillClass('triaged')).toContain('amber');
    expect(cmp.statusPillClass('other')).toContain('slate');
  });
});
