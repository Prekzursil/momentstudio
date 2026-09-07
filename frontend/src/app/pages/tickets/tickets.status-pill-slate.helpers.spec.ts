import { TicketsComponent } from './tickets.component';

/** Golden WU tip orphan — statusPillClass. */
describe('TicketsComponent statusPillClass tip (golden WU)', () => {
  function bare(): TicketsComponent {
    return Object.create(TicketsComponent.prototype) as TicketsComponent;
  }

  it('maps resolved/triaged and falls back to slate', () => {
    expect(bare().statusPillClass('resolved')).toContain('emerald');
    expect(bare().statusPillClass('triaged')).toContain('amber');
    expect(bare().statusPillClass('new')).toContain('slate');
    expect(bare().statusPillClass('wat')).toContain('slate');
  });
});
