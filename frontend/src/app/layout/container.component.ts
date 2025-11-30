import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';

@Component({
  selector: 'app-container',
  standalone: true,
  imports: [NgClass],
  template: `
    <div class="max-w-6xl mx-auto px-4 sm:px-6 w-full" [ngClass]="classes">
      <ng-content></ng-content>
    </div>
  `
})
export class ContainerComponent {
  @Input() classes = '';
}
