import { TicketsComponent } from './tickets.component';

/** Tip orphan mint — TicketsComponent.orderKey (2026-09-07T08:06:10Z). */
describe('TicketsComponent orderKey orderkey helpers (golden WU)', () => {
  function bare(): TicketsComponent {
    return Object.create(TicketsComponent.prototype) as TicketsComponent;
  }

  it('trims reference_code then id', () => {
    const cmp = bare();
    expect(cmp.orderKey({ reference_code: ' A ', id: 'b' } as any)).toBe('A');
    expect(cmp.orderKey({ id: ' B ' } as any)).toBe('B');
  });
});
