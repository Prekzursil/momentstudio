import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AdminService } from '../../../core/admin.service';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { AssetLibraryComponent } from '../shared/asset-library.component';

interface AssetsForm {
  logo_url: string;
  favicon_url: string;
  social_image_url: string;
}

/**
 * Settings > Site assets panel, extracted (behaviour-preserving) from the
 * monolithic AdminComponent. Owns the site-assets form state and its load/save
 * logic and embeds the already-extracted <app-asset-library>; the shared CMS
 * content-version bookkeeping stays on the parent and is threaded in through the
 * four callback inputs so all CMS panels keep sharing one `contentVersions` map.
 */
@Component({
  selector: 'app-admin-site-assets',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    ButtonComponent,
    InputComponent,
    AssetLibraryComponent,
  ],
  template: `
    <section
      class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {{ 'adminUi.site.assets.title' | translate }}
        </h2>
        <app-button
          size="sm"
          variant="ghost"
          [label]="'adminUi.actions.refresh' | translate"
          (action)="loadAssets()"
        ></app-button>
      </div>
      <div class="grid md:grid-cols-3 gap-3 text-sm">
        <app-input
          [label]="'adminUi.site.assets.logoUrl' | translate"
          [(value)]="assetsForm.logo_url"
        ></app-input>
        <app-input
          [label]="'adminUi.site.assets.faviconUrl' | translate"
          [(value)]="assetsForm.favicon_url"
        ></app-input>
        <app-input
          [label]="'adminUi.site.assets.socialImageUrl' | translate"
          [(value)]="assetsForm.social_image_url"
        ></app-input>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <app-button
          size="sm"
          [label]="'adminUi.site.assets.save' | translate"
          (action)="saveAssets()"
        ></app-button>
        <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="assetsMessage">{{
          assetsMessage
        }}</span>
        <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="assetsError">{{
          assetsError
        }}</span>
      </div>

      <details
        class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30"
      >
        <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
          {{ 'adminUi.site.assets.library.title' | translate }}
        </summary>
        <div class="mt-3">
          <app-asset-library [initialKey]="'site.assets'" [allowSelect]="false"></app-asset-library>
        </div>
      </details>
    </section>
  `,
})
export class AdminSiteAssetsComponent implements OnInit {
  /** Shared CMS version bookkeeping, owned by the parent AdminComponent. */
  @Input({ required: true }) rememberContentVersion!: (
    key: string,
    block: { version?: number } | null | undefined,
  ) => void;
  @Input({ required: true }) withExpectedVersion!: <T extends Record<string, unknown>>(
    key: string,
    payload: T,
  ) => T & { expected_version?: number };
  @Input({ required: true }) handleContentConflict!: (
    err: any,
    key: string,
    reload: () => void,
  ) => boolean;
  @Input({ required: true }) forgetContentVersion!: (key: string) => void;

  assetsForm: AssetsForm = { logo_url: '', favicon_url: '', social_image_url: '' };
  assetsMessage: string | null = null;
  assetsError: string | null = null;

  constructor(
    private readonly admin: AdminService,
    private readonly translate: TranslateService,
  ) {}

  ngOnInit(): void {
    this.loadAssets();
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  loadAssets(): void {
    this.assetsError = null;
    this.assetsMessage = null;
    this.admin.getContent('site.assets').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.assets', block);
        this.assetsForm = {
          logo_url: block.meta?.['logo_url'] || '',
          favicon_url: block.meta?.['favicon_url'] || '',
          social_image_url: block.meta?.['social_image_url'] || '',
        };
        this.assetsMessage = null;
      },
      error: () => {
        this.forgetContentVersion('site.assets');
        this.assetsForm = { logo_url: '', favicon_url: '', social_image_url: '' };
      },
    });
  }

  saveAssets(): void {
    const payload = {
      title: 'Site assets',
      status: 'published',
      meta: { ...this.assetsForm },
    };
    const onSuccess = (block?: { version?: number } | null) => {
      this.rememberContentVersion('site.assets', block);
      this.assetsMessage = this.t('adminUi.site.assets.success.save');
      this.assetsError = null;
    };
    this.admin
      .updateContentBlock('site.assets', this.withExpectedVersion('site.assets', payload))
      .subscribe({
        next: (block) => onSuccess(block),
        error: (err) => {
          if (this.handleContentConflict(err, 'site.assets', () => this.loadAssets())) {
            this.assetsError = this.t('adminUi.site.assets.errors.save');
            this.assetsMessage = null;
            return;
          }
          this.admin.createContent('site.assets', payload).subscribe({
            next: (created) => onSuccess(created),
            error: () => {
              this.assetsError = this.t('adminUi.site.assets.errors.save');
              this.assetsMessage = null;
            },
          });
        },
      });
  }
}
