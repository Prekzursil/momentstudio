import { TicketsComponent } from './tickets.component';

/** Golden WU tip orphan — statusPillClass default slate branch. */
describe('TicketsComponent statusPillClass (golden WU)', () => {
  function bare(): TicketsComponent {
    return Object.create(TicketsComponent.prototype) as TicketsComponent;
  }

  it('maps resolved/triaged/open statuses to pill classes', () => {
    const cmp = bare();
    expect(cmp.statusPillClass('resolved')).toContain('emerald');
    expect(cmp.statusPillClass('triaged')).toContain('amber');
    expect(cmp.statusPillClass('open')).toContain('slate');
  });
});
