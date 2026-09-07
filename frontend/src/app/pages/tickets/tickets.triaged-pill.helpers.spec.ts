import { TicketsComponent } from './tickets.component';
/** Tip orphan — statusPillClass triaged (2026-09-07T10:40:22Z). */
describe('TicketsComponent statusPillClass triaged helpers (golden WU)', () => {
  it('triaged uses amber', () => {
    const cmp = Object.create(TicketsComponent.prototype) as TicketsComponent;
    expect(cmp.statusPillClass('triaged')).toContain('amber');
  });
});
