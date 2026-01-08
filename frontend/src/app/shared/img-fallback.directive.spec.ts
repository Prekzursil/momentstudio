import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ImgFallbackDirective } from './img-fallback.directive';

@Component({
  template:
    '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" srcset="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw== 2x" [appImgFallback]="fallback" />',
  standalone: true,
  imports: [ImgFallbackDirective]
})
class HostComponent {
  fallback?: string = 'assets/placeholder/product-placeholder.svg';
}

describe('ImgFallbackDirective', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent]
    });
  });

  it('applies fallback image and clears srcset on error', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    img.dispatchEvent(new Event('error'));

    expect(img.dataset['fallbackApplied']).toBe('true');
    expect(img.src).toContain('assets/placeholder/product-placeholder.svg');
    expect(img.getAttribute('srcset')).toBeNull();
    expect(img.srcset).toBe('');
  });

  it('prevents infinite error loops by applying fallback only once', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    img.dispatchEvent(new Event('error'));
    const afterFirst = img.src;
    img.dispatchEvent(new Event('error'));

    expect(img.src).toBe(afterFirst);
  });

  it('does nothing when no fallback is provided', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const cmp = fixture.componentInstance;
    cmp.fallback = undefined;
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    const before = img.src;
    img.dispatchEvent(new Event('error'));

    expect(img.dataset['fallbackApplied']).toBeUndefined();
    expect(img.src).toBe(before);
  });
});
