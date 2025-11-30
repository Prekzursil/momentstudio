import { Component } from '@angular/core';
import { ButtonComponent } from '../../shared/button.component';
import { CardComponent } from '../../shared/card.component';
import { ContainerComponent } from '../../layout/container.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [ButtonComponent, CardComponent, ContainerComponent],
  template: `
    <section class="grid gap-10">
      <div class="grid gap-6 lg:grid-cols-[1.2fr_1fr] items-center">
        <div class="grid gap-4">
          <p class="uppercase text-sm tracking-[0.3em] text-slate-500">Handcrafted ceramic art</p>
          <h1 class="text-3xl sm:text-4xl lg:text-5xl font-semibold leading-tight text-slate-900">
            Build the AdrianaArt storefront experience.
          </h1>
          <p class="text-lg text-slate-600">
            A crisp Angular starter with Tailwind design tokens, shared components, and a responsive shell ready
            for product, cart, and content flows.
          </p>
          <div class="flex flex-wrap gap-3">
            <app-button label="Shop now" [routerLink]="['/shop']"></app-button>
            <app-button label="View admin" variant="ghost" [routerLink]="['/admin']"></app-button>
          </div>
        </div>
        <div class="relative">
          <div class="absolute -inset-4 rounded-3xl bg-slate-900/5 blur-xl"></div>
          <app-card class="relative">
            <div class="aspect-video rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 grid place-items-center text-white text-xl font-semibold">
              Hero image slot
            </div>
          </app-card>
        </div>
      </div>

      <div class="grid gap-4">
        <h2 class="text-xl font-semibold text-slate-900">Why this starter</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <app-card title="Strict TS">
            <p>Angular standalone setup with strict TypeScript and routing baked in.</p>
          </app-card>
          <app-card title="Tailwind design tokens">
            <p>Utility-first styling with a small token palette to keep UI consistent.</p>
          </app-card>
          <app-card title="Shared primitives">
            <p>Buttons, inputs, cards, modals, and toast scaffolding ready to wire.</p>
          </app-card>
          <app-card title="Resilient shell">
            <p>Global error route, responsive header/footer, and space for store pages.</p>
          </app-card>
        </div>
      </div>
    </section>
  `
})
export class HomeComponent {}
