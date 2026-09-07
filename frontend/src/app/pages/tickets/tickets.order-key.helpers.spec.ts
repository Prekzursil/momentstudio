import { TicketsComponent } from './tickets.component';

/** Tip orphan mint — TicketsComponent.orderKey (2026-09-07T07:33:00Z). */
describe('TicketsComponent orderKey (golden WU)', () => {
  function bare(): TicketsComponent {
    return Object.create(TicketsComponent.prototype) as TicketsComponent;
  }

  it('orderKey prefers reference_code, then id, else empty', () => {
    const cmp = bare();
    expect(cmp.orderKey({ reference_code: ' REF-1 ', id: 'x' } as any)).toBe('REF-1');
    expect(cmp.orderKey({ reference_code: '', id: ' id-2 ' } as any)).toBe('id-2');
    expect(cmp.orderKey({} as any)).toBe('');
  });
});
