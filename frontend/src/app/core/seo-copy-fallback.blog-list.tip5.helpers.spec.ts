import { SeoCopyFallbackService } from './seo-copy-fallback.service';

/** Golden WU tip orphan — SeoCopyFallbackService.blogListIntro. */
describe('SeoCopyFallbackService blogListIntro (golden WU tip5)', () => {
  function bare(): SeoCopyFallbackService {
    return Object.create(SeoCopyFallbackService.prototype) as SeoCopyFallbackService;
  }

  it('prefers series then tag then default copy', () => {
    const svc = bare();
    expect(SeoCopyFallbackService.prototype.blogListIntro.call(svc, 'en', 'tips', 'Studio')).toContain('Studio');
    expect(SeoCopyFallbackService.prototype.blogListIntro.call(svc, 'en', 'tips', null)).toContain('tips');
    expect(SeoCopyFallbackService.prototype.blogListIntro.call(svc, 'ro', null, null)).toContain('Exploreaza');
  });
});
