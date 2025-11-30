import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './layout/header.component';
import { FooterComponent } from './layout/footer.component';
import { ContainerComponent } from './layout/container.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ContainerComponent],
  template: `
    <div class="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <app-header></app-header>
      <app-container class="flex-1 py-8">
        <router-outlet></router-outlet>
      </app-container>
      <app-footer></app-footer>
    </div>
  `
})
export class AppComponent {}
