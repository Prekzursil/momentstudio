import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { DamAssetLibraryComponent } from '../shared/dam-asset-library.component';

@Component({
  selector: 'app-admin-content-media',
  standalone: true,
  imports: [CommonModule, TranslateModule, DamAssetLibraryComponent],
  template: `
    <section class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div class="grid gap-1">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {{ 'adminUi.content.media.title' | translate }}
        </h2>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ 'adminUi.content.media.hint' | translate }}
        </p>
      </div>

      <app-dam-asset-library></app-dam-asset-library>
    </section>
  `
})
export class AdminContentMediaComponent {
}
