import { PageComponent } from './page.component';

/** Golden WU page-show-seo-cluster — showSeoLinkCluster. */
describe('PageComponent showSeoLinkCluster (golden WU tip)', () => {
  it('hides when login required or legal index docs exist', () => {
    const cmp = Object.create(PageComponent.prototype) as PageComponent;
    (cmp as any).requiresLogin = () => false;
    (cmp as any).legalIndexDocs = () => [];
    expect(cmp.showSeoLinkCluster()).toBe(true);
    (cmp as any).requiresLogin = () => true;
    expect(cmp.showSeoLinkCluster()).toBe(false);
    (cmp as any).requiresLogin = () => false;
    (cmp as any).legalIndexDocs = () => [{ slug: 'terms' }];
    expect(cmp.showSeoLinkCluster()).toBe(false);
  });
});
