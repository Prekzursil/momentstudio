import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-container',
  standalone: true,
  template: `
    <div class="max-w-6xl mx-auto px-4 sm:px-6 w-full" [ngClass]="classes">
      <ng-content></ng-content>
    </div>
  `
})
export class ContainerComponent {
  @Input() classes = '';
}
