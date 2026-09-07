import { PageComponent } from './page.component';

/** Golden WU page-has-meaningful-body — hasMeaningfulBodyContent. */
describe('PageComponent hasMeaningfulBodyContent (golden WU tip)', () => {
  it('strips tags and requires >= 80 chars of text', () => {
    const cmp = Object.create(PageComponent.prototype) as PageComponent;
    (cmp as any).bodyHtml = () => '<p>short</p>';
    expect(cmp.hasMeaningfulBodyContent()).toBe(false);
    (cmp as any).bodyHtml = () => '<p>' + 'x'.repeat(80) + '</p>';
    expect(cmp.hasMeaningfulBodyContent()).toBe(true);
    (cmp as any).bodyHtml = () => '<div><span>' + 'a'.repeat(40) + '</span> <b>' + 'b'.repeat(40) + '</b></div>';
    expect(cmp.hasMeaningfulBodyContent()).toBe(true);
  });
});
