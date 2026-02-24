import { Directive, ElementRef, HostListener, Input } from '@angular/core';

@Directive({
  selector: 'img[appImgFallback]',
  standalone: true
})
export class ImgFallbackDirective {
  @Input('appImgFallback') fallbackSrc?: string;

  constructor(private readonly el: ElementRef<HTMLImageElement>) {}

  @HostListener('error')
  onError(): void {
    const img = this.el.nativeElement;
    if (!this.fallbackSrc) return;
    if (img.dataset['fallbackApplied'] === 'true') return;
    img.dataset['fallbackApplied'] = 'true';
    img.src = this.fallbackSrc;
    img.srcset = '';
    img.removeAttribute('srcset');
  }
}

