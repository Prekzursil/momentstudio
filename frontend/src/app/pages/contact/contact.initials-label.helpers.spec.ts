import { ContactComponent } from './contact.component';

/** Tip orphan mint — ContactComponent.initialsForLabel (2026-09-07T07:50:32Z). */
describe('ContactComponent initialsForLabel label helpers (golden WU)', () => {
  function bare(): ContactComponent {
    return Object.create(ContactComponent.prototype) as ContactComponent;
  }

  it('builds two-letter initials with MS fallback', () => {
    const cmp = bare();
    expect(cmp.initialsForLabel('   ')).toBe('MS');
    expect(cmp.initialsForLabel('Grace Hopper')).toBe('GH');
    expect(cmp.initialsForLabel('Jo')).toBe('JO');
  });
});
