import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { CarouselBlockComponent } from './carousel-block.component';
import type { CarouselSettings, Slide } from './page-blocks';

function slide(headline: string): Slide {
  return {
    image_url: `/${headline}.png`,
    headline,
    variant: 'full',
    size: 'M',
    text_style: 'dark',
  };
}

const baseSettings: CarouselSettings = {
  autoplay: false,
  interval_ms: 5000,
  show_dots: true,
  show_arrows: true,
  pause_on_hover: true,
};

describe('CarouselBlockComponent', () => {
  let fixture: ComponentFixture<CarouselBlockComponent>;
  let component: CarouselBlockComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CarouselBlockComponent, RouterTestingModule],
    }).compileComponents();
    fixture = TestBed.createComponent(CarouselBlockComponent);
    component = fixture.componentInstance;
  });

  function init(slides: Slide[], settings: Partial<CarouselSettings> = {}): void {
    component.slides = slides;
    component.settings = { ...baseSettings, ...settings };
    fixture.detectChanges();
  }

  it('creates and renders the active slide', () => {
    init([slide('a'), slide('b')]);
    expect(component).toBeTruthy();
    expect(component.activeSlide()?.headline).toBe('a');
  });

  it('returns null active slide when there are no slides', () => {
    init([]);
    expect(component.activeSlide()).toBeNull();
  });

  it('clamps the active index when out of range', () => {
    init([slide('a'), slide('b')]);
    component.activeIndex = 99;
    expect(component.activeSlide()?.headline).toBe('b');
  });

  it('returns null when the slot at the clamped index is empty', () => {
    init([undefined as unknown as Slide]);
    expect(component.activeSlide()).toBeNull();
  });

  it('navigates with next/prev wrapping around', () => {
    init([slide('a'), slide('b'), slide('c')]);
    component.next();
    expect(component.activeIndex).toBe(1);
    component.prev();
    expect(component.activeIndex).toBe(0);
    component.prev();
    expect(component.activeIndex).toBe(2);
    component.next();
    expect(component.activeIndex).toBe(0);
  });

  it('next/prev/goTo are no-ops without slides', () => {
    init([]);
    component.next();
    component.prev();
    component.goTo(2);
    expect(component.activeIndex).toBe(0);
  });

  it('goTo clamps the requested index', () => {
    init([slide('a'), slide('b')]);
    component.goTo(5);
    expect(component.activeIndex).toBe(1);
    component.goTo(-2);
    expect(component.activeIndex).toBe(0);
  });

  it('renders arrows and dots when enabled and multiple slides exist', () => {
    init([slide('a'), slide('b')], { show_arrows: true, show_dots: true });
    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(4); // 2 arrows + 2 dots
  });

  it('hides controls when only one slide', () => {
    init([slide('a')], { show_arrows: true, show_dots: true });
    expect(fixture.nativeElement.querySelectorAll('button[aria-label="Next slide"]').length).toBe(
      0,
    );
  });

  it('autoplays through slides on an interval', fakeAsync(() => {
    init([slide('a'), slide('b')], { autoplay: true, interval_ms: 2000 });
    expect(component.activeIndex).toBe(0);
    tick(2000);
    expect(component.activeIndex).toBe(1);
    component.ngOnDestroy();
    tick(2000);
    expect(component.activeIndex).toBe(1);
  }));

  it('clamps tiny intervals to the 1s minimum', fakeAsync(() => {
    init([slide('a'), slide('b')], { autoplay: true, interval_ms: 10 });
    tick(999);
    expect(component.activeIndex).toBe(0);
    tick(1);
    expect(component.activeIndex).toBe(1);
    component.ngOnDestroy();
  }));

  it('uses default interval when interval_ms is invalid', fakeAsync(() => {
    init([slide('a'), slide('b')], { autoplay: true, interval_ms: NaN });
    tick(5000);
    expect(component.activeIndex).toBe(1);
    component.ngOnDestroy();
  }));

  it('does not autoplay when disabled or with fewer than two slides', fakeAsync(() => {
    init([slide('a')], { autoplay: true });
    tick(6000);
    expect(component.activeIndex).toBe(0);
  }));

  it('pauses on hover and resumes on leave when pause_on_hover is set', fakeAsync(() => {
    init([slide('a'), slide('b')], { autoplay: true, interval_ms: 2000, pause_on_hover: true });
    component.onHover(true);
    tick(4000);
    expect(component.activeIndex).toBe(0);
    component.onHover(false);
    tick(2000);
    expect(component.activeIndex).toBe(1);
    component.ngOnDestroy();
  }));

  it('ignores hover when pause_on_hover is disabled', fakeAsync(() => {
    init([slide('a'), slide('b')], { autoplay: true, interval_ms: 2000, pause_on_hover: false });
    component.onHover(true);
    tick(2000);
    expect(component.activeIndex).toBe(1);
    component.ngOnDestroy();
  }));

  it('does not start autoplay while hovered', fakeAsync(() => {
    init([slide('a'), slide('b')], { autoplay: true, interval_ms: 2000, pause_on_hover: true });
    component.onHover(true);
    // restartAutoplay via goTo should not resume while hovered
    component.goTo(0);
    tick(2000);
    expect(component.activeIndex).toBe(0);
    component.ngOnDestroy();
  }));
});
