import { NotFoundComponent } from './not-found.component';
import { notFoundHomeLinks } from './not-found.helpers';

/** Golden WU tip orphan — homeLinks export. */
describe('NotFoundComponent homeLinks (golden WU)', () => {
  it('exposes home escape paths from helper', () => {
    const cmp = Object.create(NotFoundComponent.prototype) as NotFoundComponent;
    Object.assign(cmp as any, { homeLinks: notFoundHomeLinks() });
    expect(cmp.homeLinks.map((l) => l.path)).toEqual(['/']);
    expect(cmp.homeLinks[0].kind).toBe('home');
  });
});
