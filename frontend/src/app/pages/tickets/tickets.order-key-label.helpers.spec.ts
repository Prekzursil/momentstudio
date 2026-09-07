import { TicketsComponent } from './tickets.component';

/** Golden WU tickets-order-key-label — orderKey / orderLabel. */
describe('TicketsComponent orderKey / orderLabel (golden WU tip)', () => {
  it('prefers reference_code and formats date stamp when present', () => {
    const cmp = Object.create(TicketsComponent.prototype) as TicketsComponent;
    expect(cmp.orderKey({ id: 'id-1', reference_code: ' REF-9 ' } as any)).toBe('REF-9');
    expect(cmp.orderKey({ id: 'id-2', reference_code: '' } as any)).toBe('id-2');
    expect(cmp.orderLabel({ id: 'id-3', reference_code: 'A1', created_at: null } as any)).toBe('A1');
    const withDate = cmp.orderLabel({
      id: 'id-4',
      reference_code: 'B2',
      created_at: '2024-01-15T12:00:00.000Z',
    } as any);
    expect(withDate.startsWith('B2 · ')).toBe(true);
  });
});
