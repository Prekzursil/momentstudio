import { ContactComponent } from './contact.component';

/** Golden WU tip orphan — initialsForLabel. */
describe('ContactComponent initialsForLabel (golden WU)', () => {
  function bare(): ContactComponent {
    return Object.create(ContactComponent.prototype) as ContactComponent;
  }

  it('builds two-letter initials', () => {
    const cmp = bare();
    expect(cmp.initialsForLabel('Moment Studio')).toBe('MS');
    expect(cmp.initialsForLabel('')).toBe('MS');
    expect(cmp.initialsForLabel('Ada')).toBe('AD');
  });
});
