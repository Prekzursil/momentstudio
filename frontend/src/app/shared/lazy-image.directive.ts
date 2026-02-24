import { Directive, ElementRef, Input, OnDestroy, OnInit, Renderer2 } from '@angular/core';

@Directive({
  selector: '[appLazyImage]',
  standalone: true
})
export class LazyImageDirective implements OnInit, OnDestroy {
  @Input('appLazyImage') src = '';
  @Input() alt = '';

  private observer?: IntersectionObserver;

  constructor(private readonly el: ElementRef<HTMLImageElement>, private renderer: Renderer2) {}

  ngOnInit(): void {
    if (!this.src) return;
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.loadImage();
            this.observer?.disconnect();
          }
        });
      });
      this.observer.observe(this.el.nativeElement);
    } else {
      this.loadImage();
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private loadImage(): void {
    this.renderer.setAttribute(this.el.nativeElement, 'src', this.src);
    if (this.alt) {
      this.renderer.setAttribute(this.el.nativeElement, 'alt', this.alt);
    }
    this.renderer.addClass(this.el.nativeElement, 'transition-opacity');
    this.renderer.addClass(this.el.nativeElement, 'duration-300');
    this.renderer.addClass(this.el.nativeElement, 'opacity-100');
  }
}

