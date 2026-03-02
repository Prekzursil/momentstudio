import { CarouselBlockComponent } from './carousel-block.component';

function createCarouselBlockComponent(): CarouselBlockComponent {
  const component = new CarouselBlockComponent();
  component.slides = [
    { headline: { en: 'One', ro: 'One' }, image_url: '/1.jpg' },
    { headline: { en: 'Two', ro: 'Two' }, image_url: '/2.jpg' },
    { headline: { en: 'Three', ro: 'Three' }, image_url: '/3.jpg' }
  ] as any;
  component.settings = {
    autoplay: false,
    interval_ms: 1200,
    show_dots: true,
    show_arrows: true,
    pause_on_hover: true
  } as any;
  return component;
}

describe('CarouselBlockComponent', () => {
  it('returns active slide with bounds checks', () => {
    const component = createCarouselBlockComponent();
    component.activeIndex = 1;
    expect(component.activeSlide()?.image_url).toBe('/2.jpg');

    component.activeIndex = -10;
    expect(component.activeSlide()?.image_url).toBe('/1.jpg');

    component.activeIndex = 99;
    expect(component.activeSlide()?.image_url).toBe('/3.jpg');

    component.slides = [];
    expect(component.activeSlide()).toBeNull();
  });

  it('navigates slides and restarts autoplay', () => {
    const component = createCarouselBlockComponent();
    const restartSpy = spyOn<any>(component as any, 'restartAutoplay').and.callThrough();

    component.goTo(2);
    expect(component.activeIndex).toBe(2);

    component.prev();
    expect(component.activeIndex).toBe(1);

    component.next();
    expect(component.activeIndex).toBe(2);

    component.goTo(-100);
    expect(component.activeIndex).toBe(0);

    component.goTo(999);
    expect(component.activeIndex).toBe(2);

    expect(restartSpy).toHaveBeenCalled();
  });

  it('starts and stops autoplay with hover behavior', () => {
    jasmine.clock().install();
    try {
      const component = createCarouselBlockComponent();
      component.settings.autoplay = true;
      component.settings.interval_ms = 900;
      component.ngOnInit();

      expect(component.activeIndex).toBe(0);
      jasmine.clock().tick(1100);
      expect(component.activeIndex).toBe(1);

      component.onHover(true);
      const indexAfterHover = component.activeIndex;
      jasmine.clock().tick(1100);
      expect(component.activeIndex).toBe(indexAfterHover);

      component.onHover(false);
      jasmine.clock().tick(1100);
      expect(component.activeIndex).toBe((indexAfterHover + 1) % component.slides.length);

      component.ngOnDestroy();
      const indexAfterDestroy = component.activeIndex;
      jasmine.clock().tick(1100);
      expect(component.activeIndex).toBe(indexAfterDestroy);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('does not autoplay when disabled or with a single slide', () => {
    jasmine.clock().install();
    try {
      const component = createCarouselBlockComponent();
      component.settings.autoplay = false;
      component.ngOnInit();
      jasmine.clock().tick(2000);
      expect(component.activeIndex).toBe(0);

      component.settings.autoplay = true;
      component.slides = [component.slides[0]];
      component.ngOnInit();
      jasmine.clock().tick(2000);
      expect(component.activeIndex).toBe(0);
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
