import { TicketsComponent } from './tickets.component';

/** Tip orphan mint — TicketsComponent.orderLabel (2026-09-07T08:14:48Z). */
describe('TicketsComponent orderLabel helpers (golden WU)', () => {
  function bare(): TicketsComponent {
    return Object.create(TicketsComponent.prototype) as TicketsComponent;
  }

  it('orderLabel uses orderKey and optional date stamp', () => {
    const cmp = bare();
    spyOn(cmp, 'orderKey').and.returnValue('REF');
    expect(cmp.orderLabel({} as any)).toBe('REF');
    expect(cmp.orderLabel({ created_at: '2020-01-15T12:00:00Z' } as any)).toContain('REF');
  });
});
