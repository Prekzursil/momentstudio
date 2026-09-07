import { BlogListComponent } from './blog-list.component';

/** Golden WU tip orphan — thumbUrl. */
describe('BlogListComponent thumbUrl (golden WU)', () => {
  function bare(): BlogListComponent {
    const cmp = Object.create(BlogListComponent.prototype) as BlogListComponent;
    Object.assign(cmp as any, { failedThumbs: new Set<string>() });
    return cmp;
  }

  it('builds -sm thumb path for /media/ URLs and skips failed thumbs', () => {
    const cmp = bare();
    expect(cmp.thumbUrl('/media/blog/photo.jpg')).toBe('/media/blog/photo-sm.jpg');
    expect(cmp.thumbUrl('https://cdn/x.jpg')).toBeNull();
    cmp.markThumbFailed('/media/blog/photo-sm.jpg');
    expect(cmp.thumbUrl('/media/blog/photo.jpg')).toBeNull();
  });
});
