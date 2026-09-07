import { ContactComponent } from './contact.component';
/** Tip orphan — focalPosition default (2026-09-07T10:40:22Z). */
describe('ContactComponent focalPosition default helpers (golden WU)', () => {
  it('defaults to 50% 50%', () => {
    const cmp = Object.create(ContactComponent.prototype) as ContactComponent;
    expect(cmp.focalPosition()).toBe('50% 50%');
  });
});
