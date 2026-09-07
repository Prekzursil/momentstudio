import { TicketsComponent } from './tickets.component';

/** Golden WU tip orphan — orderKey. */
describe('TicketsComponent orderKey (golden WU)', () => {
  function bare(): TicketsComponent {
    return Object.create(TicketsComponent.prototype) as TicketsComponent;
  }

  it('prefers reference_code then id, trimmed', () => {
    expect(bare().orderKey({ reference_code: '  ABC  ', id: '1' } as any)).toBe('ABC');
    expect(bare().orderKey({ reference_code: '', id: '  id9  ' } as any)).toBe('id9');
  });
});
