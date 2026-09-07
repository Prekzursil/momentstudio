import { TicketsComponent } from './tickets.component';
/** Tip orphan — orderKey trim (2026-09-07T12:02:09Z). */
describe('TicketsComponent orderKey trim helpers (golden WU)', () => {
  it('trims whitespace around reference_code', () => {
    const cmp = Object.create(TicketsComponent.prototype) as TicketsComponent;
    expect(cmp.orderKey({ reference_code: '  R1  ' } as any)).toBe('R1');
  });
});
