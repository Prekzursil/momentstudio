import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { AssetLibraryComponent } from '../shared/asset-library.component';

@Component({
  selector: 'app-admin-content-media',
  standalone: true,
  imports: [CommonModule, TranslateModule, AssetLibraryComponent],
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

      <app-asset-library
        titleKey="adminUi.content.media.libraryTitle"
        [allowUpload]="true"
        [allowSelect]="false"
        [uploadKey]="'site.assets'"
        [scopedKeys]="scopedKeys"
      ></app-asset-library>
    </section>
  `
})
export class AdminContentMediaComponent {
  readonly scopedKeys = [
    'site.assets',
    'site.social',
    'site.company',
    'home.hero',
    'home.story',
    'home.sections'
  ];
}
