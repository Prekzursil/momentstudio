import { Component } from '@angular/core';

@Component({
  selector: 'app-admin',
  standalone: true,
  template: `
    <div class="grid gap-4 py-8 text-center">
      <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Admin</p>
      <h1 class="text-3xl font-semibold text-slate-900">Admin dashboard placeholder</h1>
      <p class="text-slate-600">Protected route guarded by adminGuard.</p>
    </div>
  `
})
export class AdminComponent {}
