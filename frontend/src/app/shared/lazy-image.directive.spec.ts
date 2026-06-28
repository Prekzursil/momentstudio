import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { LazyImageDirective } from './lazy-image.directive';

@Component({
  template: '<img [appLazyImage]="src" [alt]="alt" />',
  standalone: true,
  imports: [LazyImageDirective],
})
class HostComponent {
  src = '';
  alt = '';
}

/**
 * Test double for IntersectionObserver that records observe/disconnect calls
 * and lets a test drive the observer callback synchronously.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observe = jasmine.createSpy('observe');
  readonly disconnect = jasmine.createSpy('disconnect');

  constructor(public readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  trigger(isIntersecting: boolean): void {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

describe('LazyImageDirective', () => {
  const SRC = 'https://example.com/lazy.jpg';
  let originalIO: typeof IntersectionObserver | undefined;

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    originalIO = (window as unknown as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      FakeIntersectionObserver;

    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  afterEach(() => {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = originalIO;
  });

  function setup(src: string, alt = '') {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.src = src;
    fixture.componentInstance.alt = alt;
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    const directive = fixture.debugElement
      .query(By.directive(LazyImageDirective))
      .injector.get(LazyImageDirective);
    return { fixture, img, directive };
  }

  it('does not observe or load when src is empty', () => {
    const { fixture, img } = setup('');

    expect(FakeIntersectionObserver.instances.length).toBe(0);
    expect(img.classList.contains('transition-opacity')).toBe(false);
    expect(img.getAttribute('src')).toBeNull();

    // ngOnDestroy with no observer must not throw.
    expect(() => fixture.destroy()).not.toThrow();
  });

  it('observes the host element when IntersectionObserver is supported', () => {
    const { img } = setup(SRC);

    expect(FakeIntersectionObserver.instances.length).toBe(1);
    expect(FakeIntersectionObserver.instances[0].observe).toHaveBeenCalledWith(img);
    // Image is not loaded until it intersects.
    expect(img.getAttribute('src')).toBeNull();
  });

  it('loads the image, sets alt, applies classes and disconnects on intersection', () => {
    const { img } = setup(SRC, 'Lazy alt text');
    const observer = FakeIntersectionObserver.instances[0];

    observer.trigger(true);

    expect(img.getAttribute('src')).toBe(SRC);
    expect(img.getAttribute('alt')).toBe('Lazy alt text');
    expect(img.classList.contains('transition-opacity')).toBe(true);
    expect(img.classList.contains('duration-300')).toBe(true);
    expect(img.classList.contains('opacity-100')).toBe(true);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not load the image when the element is not intersecting', () => {
    const { img } = setup(SRC, 'Lazy alt text');
    const observer = FakeIntersectionObserver.instances[0];

    observer.trigger(false);

    expect(img.getAttribute('src')).toBeNull();
    expect(img.classList.contains('transition-opacity')).toBe(false);
    expect(observer.disconnect).not.toHaveBeenCalled();
  });

  it('does not set the alt attribute when alt is empty', () => {
    const { img } = setup(SRC, '');

    FakeIntersectionObserver.instances[0].trigger(true);

    expect(img.getAttribute('src')).toBe(SRC);
    expect(img.getAttribute('alt')).toBeNull();
    expect(img.classList.contains('opacity-100')).toBe(true);
  });

  it('loads the image eagerly when IntersectionObserver is unavailable', () => {
    delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;

    const { img } = setup(SRC, 'Eager alt');

    expect(FakeIntersectionObserver.instances.length).toBe(0);
    expect(img.getAttribute('src')).toBe(SRC);
    expect(img.getAttribute('alt')).toBe('Eager alt');
    expect(img.classList.contains('transition-opacity')).toBe(true);
  });

  it('disconnects the observer on destroy', () => {
    const { fixture } = setup(SRC);
    const observer = FakeIntersectionObserver.instances[0];

    fixture.destroy();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('loads safely on intersection even if the observer was already cleared', () => {
    const { img, directive } = setup(SRC, 'Defensive alt');
    const observer = FakeIntersectionObserver.instances[0];
    // Simulate the observer reference being cleared before the callback fires;
    // the optional-chained disconnect must be skipped without error.
    (directive as unknown as { observer?: IntersectionObserver }).observer = undefined;

    expect(() => observer.trigger(true)).not.toThrow();

    expect(img.getAttribute('src')).toBe(SRC);
    expect(img.getAttribute('alt')).toBe('Defensive alt');
    expect(observer.disconnect).not.toHaveBeenCalled();
  });
});
