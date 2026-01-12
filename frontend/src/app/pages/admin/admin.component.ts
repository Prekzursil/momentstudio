import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CardComponent } from '../../shared/card.component';
import { ButtonComponent } from '../../shared/button.component';
import { InputComponent } from '../../shared/input.component';
import { RichEditorComponent } from '../../shared/rich-editor.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { SkeletonComponent } from '../../shared/skeleton.component';
import {
  AdminService,
  AdminSummary,
  AdminProduct,
  AdminOrder,
  AdminUser,
  AdminUserAliasesResponse,
  AdminContent,
  AdminCoupon,
  AdminAudit,
  LowStockItem,
  AdminCategory,
  AdminProductDetail,
  FeaturedCollection,
  ContentBlockVersionListItem,
  ContentBlockVersionRead
} from '../../core/admin.service';
import { AdminBlogComment, BlogService } from '../../core/blog.service';
import { FxAdminService, FxAdminStatus } from '../../core/fx-admin.service';
import { ToastService } from '../../core/toast.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { MarkdownService } from '../../core/markdown.service';
import { AuthService } from '../../core/auth.service';
import { diffLines } from 'diff';
import { formatIdentity } from '../../shared/user-identity';

type AdminContentSection = 'home' | 'pages' | 'blog' | 'settings';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    BreadcrumbComponent,
    CardComponent,
    ButtonComponent,
    InputComponent,
    RichEditorComponent,
    LocalizedCurrencyPipe,
    SkeletonComponent,
    TranslateModule
  ],
 template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
        {{ error() }}
      </div>
      <div class="grid gap-6" *ngIf="!loading(); else loadingTpl">
	          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	            <div class="flex items-center justify-between">
	              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.assets.title' | translate }}</h2>
	              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadAssets()"></app-button>
	            </div>
	            <div class="grid md:grid-cols-3 gap-3 text-sm">
	              <app-input [label]="'adminUi.site.assets.logoUrl' | translate" [(value)]="assetsForm.logo_url"></app-input>
	              <app-input [label]="'adminUi.site.assets.faviconUrl' | translate" [(value)]="assetsForm.favicon_url"></app-input>
	              <app-input [label]="'adminUi.site.assets.socialImageUrl' | translate" [(value)]="assetsForm.social_image_url"></app-input>
            </div>
            <div class="flex items-center gap-2 text-sm">
              <app-button size="sm" [label]="'adminUi.site.assets.save' | translate" (action)="saveAssets()"></app-button>
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="assetsMessage">{{ assetsMessage }}</span>
              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="assetsError">{{ assetsError }}</span>
            </div>
          </section>

	          <section *ngIf="section() === 'settings'" class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	            <div class="flex items-center justify-between gap-3">
	              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.social.title' | translate }}</h2>
	              <div class="flex items-center gap-2">
	                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadSocial()"></app-button>
	                <app-button size="sm" [label]="'adminUi.actions.save' | translate" (action)="saveSocial()"></app-button>
	              </div>
	            </div>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input [label]="'adminUi.site.social.phone' | translate" [(value)]="socialForm.phone"></app-input>
              <app-input [label]="'adminUi.site.social.email' | translate" [(value)]="socialForm.email"></app-input>
            </div>
            <div class="grid md:grid-cols-2 gap-4">
              <div class="grid gap-2">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.social.instagramPages' | translate }}</p>
                  <button class="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300" type="button" (click)="addSocialLink('instagram')">
                    {{ 'adminUi.actions.add' | translate }}
                  </button>
                </div>
                <div *ngFor="let page of socialForm.instagram_pages; let i = index" class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
                  <app-input [label]="'adminUi.site.social.label' | translate" [(value)]="page.label"></app-input>
                  <app-input [label]="'adminUi.site.social.url' | translate" [(value)]="page.url"></app-input>
                  <app-input [label]="'adminUi.site.social.thumbnailUrlOptional' | translate" [(value)]="page.thumbnail_url"></app-input>
                  <div class="flex items-center gap-2">
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.site.social.fetchThumbnail' | translate"
                      [disabled]="socialThumbLoading[socialThumbKey('instagram', i)] || !(page.url || '').trim()"
                      (action)="fetchSocialThumbnail('instagram', i)"
                    ></app-button>
                    <span *ngIf="socialThumbLoading[socialThumbKey('instagram', i)]" class="text-xs text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.site.social.fetching' | translate }}
                    </span>
                    <span *ngIf="socialThumbErrors[socialThumbKey('instagram', i)]" class="text-xs text-rose-700 dark:text-rose-300">
                      {{ socialThumbErrors[socialThumbKey('instagram', i)] }}
                    </span>
                  </div>
                  <img
                    *ngIf="(page.thumbnail_url || '').trim()"
                    [src]="page.thumbnail_url"
                    [alt]="page.label"
                    class="h-10 w-10 rounded-full border border-slate-200 object-cover dark:border-slate-800"
                    loading="lazy"
                  />
                  <button class="text-xs text-rose-700 hover:underline dark:text-rose-300 justify-self-start" type="button" (click)="removeSocialLink('instagram', i)">
                    {{ 'adminUi.actions.remove' | translate }}
                  </button>
                </div>
              </div>
              <div class="grid gap-2">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.social.facebookPages' | translate }}</p>
                  <button class="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300" type="button" (click)="addSocialLink('facebook')">
                    {{ 'adminUi.actions.add' | translate }}
                  </button>
                </div>
                <div *ngFor="let page of socialForm.facebook_pages; let i = index" class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
                  <app-input [label]="'adminUi.site.social.label' | translate" [(value)]="page.label"></app-input>
                  <app-input [label]="'adminUi.site.social.url' | translate" [(value)]="page.url"></app-input>
                  <app-input [label]="'adminUi.site.social.thumbnailUrlOptional' | translate" [(value)]="page.thumbnail_url"></app-input>
                  <div class="flex items-center gap-2">
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.site.social.fetchThumbnail' | translate"
                      [disabled]="socialThumbLoading[socialThumbKey('facebook', i)] || !(page.url || '').trim()"
                      (action)="fetchSocialThumbnail('facebook', i)"
                    ></app-button>
                    <span *ngIf="socialThumbLoading[socialThumbKey('facebook', i)]" class="text-xs text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.site.social.fetching' | translate }}
                    </span>
                    <span *ngIf="socialThumbErrors[socialThumbKey('facebook', i)]" class="text-xs text-rose-700 dark:text-rose-300">
                      {{ socialThumbErrors[socialThumbKey('facebook', i)] }}
                    </span>
                  </div>
                  <img
                    *ngIf="(page.thumbnail_url || '').trim()"
                    [src]="page.thumbnail_url"
                    [alt]="page.label"
                    class="h-10 w-10 rounded-full border border-slate-200 object-cover dark:border-slate-800"
                    loading="lazy"
                  />
                  <button class="text-xs text-rose-700 hover:underline dark:text-rose-300 justify-self-start" type="button" (click)="removeSocialLink('facebook', i)">
                    {{ 'adminUi.actions.remove' | translate }}
                  </button>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 text-sm">
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="socialMessage">{{ socialMessage }}</span>
              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="socialError">{{ socialError }}</span>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.seo.title' | translate }}</h2>
              <div class="flex gap-2 text-sm">
                <label class="flex items-center gap-2">
                  {{ 'adminUi.site.seo.page' | translate }}
                  <select
                    class="rounded border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="seoPage"
                    (ngModelChange)="loadSeo()"
                  >
                    <option value="home">{{ 'adminUi.site.seo.pages.home' | translate }}</option>
                    <option value="shop">{{ 'adminUi.site.seo.pages.shop' | translate }}</option>
                    <option value="product">{{ 'adminUi.site.seo.pages.product' | translate }}</option>
                    <option value="category">{{ 'adminUi.site.seo.pages.category' | translate }}</option>
                    <option value="about">{{ 'adminUi.site.seo.pages.about' | translate }}</option>
                  </select>
                </label>
                <div class="flex items-center gap-2">
                  <button
                    class="px-3 py-1 rounded border"
                    [class.bg-slate-900]="seoLang === 'en'"
                    [class.text-white]="seoLang === 'en'"
                    (click)="selectSeoLang('en')"
                  >
                    EN
                  </button>
                  <button
                    class="px-3 py-1 rounded border"
                    [class.bg-slate-900]="seoLang === 'ro'"
                    [class.text-white]="seoLang === 'ro'"
                    (click)="selectSeoLang('ro')"
                  >
                    RO
                  </button>
                </div>
              </div>
            </div>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input [label]="'adminUi.site.seo.metaTitle' | translate" [(value)]="seoForm.title"></app-input>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                {{ 'adminUi.site.seo.metaDescription' | translate }}
                <textarea
                  rows="2"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="seoForm.description"
                ></textarea>
              </label>
            </div>
            <div class="flex items-center gap-2 text-sm">
              <app-button size="sm" [label]="'adminUi.site.seo.save' | translate" (action)="saveSeo()"></app-button>
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="seoMessage">{{ seoMessage }}</span>
              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="seoError">{{ seoError }}</span>
            </div>
          </section>

          <section *ngIf="section() === 'pages'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.pages.title' | translate }}</h2>
              <div class="flex gap-2 text-sm">
                <button
                  class="px-3 py-1 rounded border"
                  [class.bg-slate-900]="infoLang === 'en'"
                  [class.text-white]="infoLang === 'en'"
                  (click)="selectInfoLang('en')"
                >
                  EN
                </button>
                <button
                  class="px-3 py-1 rounded border"
                  [class.bg-slate-900]="infoLang === 'ro'"
                  [class.text-white]="infoLang === 'ro'"
                  (click)="selectInfoLang('ro')"
                >
                  RO
                </button>
              </div>
            </div>
            <div class="grid gap-3 text-sm">
              <label class="grid gap-1 font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.site.pages.aboutLabel' | translate }}
                <textarea
                  rows="3"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="infoForm.about"
                ></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" [label]="'adminUi.site.pages.saveAbout' | translate" (action)="saveInfo('page.about', infoForm.about)"></app-button>
              </div>
              <label class="grid gap-1 font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.site.pages.faqLabel' | translate }}
                <textarea
                  rows="3"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="infoForm.faq"
                ></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" [label]="'adminUi.site.pages.saveFaq' | translate" (action)="saveInfo('page.faq', infoForm.faq)"></app-button>
              </div>
              <label class="grid gap-1 font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.site.pages.shippingLabel' | translate }}
                <textarea
                  rows="3"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="infoForm.shipping"
                ></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" [label]="'adminUi.site.pages.saveShipping' | translate" (action)="saveInfo('page.shipping', infoForm.shipping)"></app-button>
              </div>
              <label class="grid gap-1 font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.site.pages.contactLabel' | translate }}
                <textarea
                  rows="3"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="infoForm.contact"
                ></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" [label]="'adminUi.site.pages.saveContact' | translate" (action)="saveInfo('page.contact', infoForm.contact)"></app-button>
                <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="infoMessage">{{ infoMessage }}</span>
                <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="infoError">{{ infoError }}</span>
              </div>
            </div>
          </section>

          <section *ngIf="section() === 'home'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.home.hero.title' | translate }}</h2>
              <div class="flex gap-2 text-sm">
                <button
                  class="px-3 py-1 rounded border"
                  [class.bg-slate-900]="heroLang === 'en'"
                  [class.text-white]="heroLang === 'en'"
                  (click)="selectHeroLang('en')"
                >
                  EN
                </button>
                <button
                  class="px-3 py-1 rounded border"
                  [class.bg-slate-900]="heroLang === 'ro'"
                  [class.text-white]="heroLang === 'ro'"
                  (click)="selectHeroLang('ro')"
                >
                  RO
                </button>
              </div>
            </div>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input [label]="'adminUi.home.hero.headline' | translate" [(value)]="heroForm.title"></app-input>
              <app-input [label]="'adminUi.home.hero.subtitle' | translate" [(value)]="heroForm.subtitle"></app-input>
              <app-input [label]="'adminUi.home.hero.ctaLabel' | translate" [(value)]="heroForm.cta_label"></app-input>
              <app-input [label]="'adminUi.home.hero.ctaUrl' | translate" [(value)]="heroForm.cta_url"></app-input>
              <app-input [label]="'adminUi.home.hero.imageUrl' | translate" [(value)]="heroForm.image"></app-input>
            </div>
            <div class="flex gap-2">
              <app-button [label]="'adminUi.actions.save' | translate" (action)="saveHero()"></app-button>
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="heroMessage()">{{ heroMessage() }}</span>
              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="heroError()">{{ heroError() }}</span>
            </div>
          </section>

          <section *ngIf="section() === 'home'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.home.sections.title' | translate }}</h2>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.save' | translate" (action)="saveSections()"></app-button>
            </div>
            <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.home.sections.hint' | translate }}</p>
            <div class="grid gap-2">
              <div
                *ngFor="let section of sectionOrder"
                class="flex items-center justify-between rounded-lg border border-dashed border-slate-300 p-3 text-sm bg-slate-50 dark:border-slate-700 dark:bg-slate-950/30"
                draggable="true"
                (dragstart)="onSectionDragStart(section)"
                (dragover)="onSectionDragOver($event)"
                (drop)="onSectionDrop(section)"
              >
                <div class="grid gap-1">
                  <span class="font-semibold text-slate-900 dark:text-slate-50">{{ sectionLabel(section) }}</span>
                  <span class="text-[11px] text-slate-500 dark:text-slate-400">{{ section }}</span>
                </div>
                <div class="flex items-center gap-3">
                  <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input type="checkbox" [checked]="isSectionEnabled(section)" (change)="toggleSectionEnabled(section, $event)" />
                    {{ 'adminUi.home.sections.enabled' | translate }}
                  </label>
                  <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.home.sections.drag' | translate }}</span>
                </div>
              </div>
            </div>
            <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="sectionsMessage">{{ sectionsMessage }}</span>
          </section>

          <section *ngIf="section() === 'home'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.home.collections.title' | translate }}</h2>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.reset' | translate" (action)="resetCollectionForm()"></app-button>
            </div>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input [label]="'adminUi.home.collections.slug' | translate" [(value)]="collectionForm.slug"></app-input>
              <app-input [label]="'adminUi.home.collections.name' | translate" [(value)]="collectionForm.name"></app-input>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                {{ 'adminUi.home.collections.description' | translate }}
                <textarea class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" rows="2" [(ngModel)]="collectionForm.description"></textarea>
              </label>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                {{ 'adminUi.home.collections.products' | translate }}
                <select multiple class="rounded-lg border border-slate-200 bg-white px-3 py-2 min-h-[120px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="collectionForm.product_ids">
                  <option *ngFor="let p of products" [value]="p.id">{{ p.name }} ({{ p.slug }})</option>
                </select>
              </label>
            </div>
            <div class="flex gap-2">
              <app-button
                [label]="editingCollection ? ('adminUi.home.collections.update' | translate) : ('adminUi.home.collections.create' | translate)"
                (action)="saveCollection()"
              ></app-button>
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="collectionMessage">{{ collectionMessage }}</span>
            </div>
            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div *ngFor="let col of featuredCollections" class="rounded-lg border border-slate-200 p-3 flex items-center justify-between dark:border-slate-700">
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ col.name }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ col.slug }} · {{ col.description }}</p>
                </div>
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.edit' | translate" (action)="editCollection(col)"></app-button>
              </div>
            </div>
          </section>

          <section *ngIf="false" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.products.title' | translate }}</h2>
              <div class="flex gap-2">
                <app-button size="sm" [label]="'adminUi.products.new' | translate" (action)="startNewProduct()"></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.delete' | translate"
                  [disabled]="!selectedIds.size"
                  (action)="deleteSelected()"
                ></app-button>
                <div class="flex items-center gap-2 text-xs">
                  <app-input label="Bulk stock" type="number" [(value)]="bulkStock"></app-input>
                  <app-button size="sm" label="Apply to selected" [disabled]="!selectedIds.size || bulkStock === null" (action)="saveBulkStock()"></app-button>
                </div>
              </div>
            </div>
            <div class="overflow-auto">
              <table class="min-w-full text-sm text-left">
                <thead>
                  <tr class="border-b border-slate-200 dark:border-slate-800">
                    <th class="py-2">
                      <input type="checkbox" [checked]="allSelected" (change)="toggleAll($event)" />
                    </th>
                    <th class="py-2">{{ 'adminUi.products.table.name' | translate }}</th>
                    <th>{{ 'adminUi.products.table.price' | translate }}</th>
                    <th>{{ 'adminUi.products.table.status' | translate }}</th>
                    <th>{{ 'adminUi.products.table.category' | translate }}</th>
                    <th>{{ 'adminUi.products.table.stock' | translate }}</th>
                    <th>Publish at</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let product of products" class="border-b border-slate-100 dark:border-slate-800">
                    <td class="py-2">
                      <input
                        type="checkbox"
                        [checked]="selectedIds.has(product.id)"
                        (change)="toggleSelect(product.id, $event)"
                      />
                    </td>
                    <td class="py-2 font-semibold text-slate-900 dark:text-slate-50">
                      {{ product.name }}
                      <span *ngIf="product.tags?.includes('bestseller')" class="ml-2 text-[10px] uppercase bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Bestseller</span>
                      <span *ngIf="product.tags?.includes('highlight')" class="ml-1 text-[10px] uppercase bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full">Highlight</span>
                    </td>
                    <td>{{ product.price | localizedCurrency : product.currency || 'RON' }}</td>
                    <td><span class="text-xs rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">{{ product.status }}</span></td>
                    <td>{{ product.category }}</td>
                    <td class="flex items-center gap-2">
                      <input
                        class="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        type="number"
                        [ngModel]="stockEdits[product.id] ?? product.stock_quantity"
                        (ngModelChange)="setStock(product.id, $event)"
                      />
                      <app-button size="xs" variant="ghost" label="Save" (action)="saveStock(product)"></app-button>
                    </td>
                    <td>
                      <span *ngIf="product.publish_at" class="text-xs text-slate-600 dark:text-slate-300">{{ product.publish_at | date: 'short' }}</span>
                      <span *ngIf="!product.publish_at" class="text-xs text-slate-400 dark:text-slate-500">—</span>
                    </td>
                    <td class="flex gap-2 py-2">
                      <app-button size="sm" variant="ghost" [label]="'adminUi.products.actions.update' | translate" (action)="loadProduct(product.slug)"></app-button>
                      <app-button size="sm" variant="ghost" label="Duplicate" (action)="duplicateProduct(product.slug)"></app-button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div *ngIf="upcomingProducts().length" class="rounded-lg border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
              <p class="font-semibold text-slate-900 dark:text-slate-50 mb-2">Upcoming scheduled products</p>
              <div *ngFor="let p of upcomingProducts()" class="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                <span>{{ p.name }}</span>
                <span class="text-xs text-slate-600 dark:text-slate-300">Publishes {{ p.publish_at | date: 'medium' }}</span>
              </div>
            </div>
          </section>

          <section *ngIf="false" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {{ editingId ? ('adminUi.products.edit' | translate) : ('adminUi.products.create' | translate) }}
              </h2>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.reset' | translate" (action)="startNewProduct()"></app-button>
            </div>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input [label]="'adminUi.products.table.name' | translate" [(value)]="form.name"></app-input>
              <app-input [label]="'adminUi.products.form.slug' | translate" [(value)]="form.slug"></app-input>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.products.table.category' | translate }}
                <select class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="form.category_id">
                  <option *ngFor="let c of categories" [value]="c.id">{{ c.name }}</option>
                </select>
              </label>
              <app-input [label]="'adminUi.products.table.price' | translate" type="number" [(value)]="form.price"></app-input>
              <app-input [label]="'adminUi.products.table.stock' | translate" type="number" [(value)]="form.stock"></app-input>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                Publish at (optional)
                <input class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" type="datetime-local" [(ngModel)]="form.publish_at" />
              </label>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.products.table.status' | translate }}
                <select class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="form.status">
                  <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                  <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                  <option value="archived">{{ 'adminUi.status.archived' | translate }}</option>
                </select>
              </label>
              <app-input [label]="'adminUi.products.form.sku' | translate" [(value)]="form.sku"></app-input>
              <app-input [label]="'adminUi.products.form.imageUrl' | translate" [(value)]="form.image"></app-input>
            </div>
            <div class="flex items-center gap-4 text-sm">
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="form.is_bestseller" /> Bestseller badge
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="form.is_highlight" /> Highlight badge
              </label>
            </div>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.products.form.description' | translate }}
              <textarea rows="3" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="form.description"></textarea>
            </label>
            <div class="flex gap-3">
              <app-button [label]="'adminUi.products.form.save' | translate" (action)="saveProduct()"></app-button>
              <label class="text-sm text-indigo-600 dark:text-indigo-300 font-medium cursor-pointer">
                {{ 'adminUi.products.form.upload' | translate }}
                <input type="file" class="hidden" accept="image/*" (change)="onImageUpload($event)" />
              </label>
            </div>
            <div class="grid gap-2" *ngIf="productImages().length">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.products.form.images' | translate }}</p>
              <div *ngFor="let img of productImages()" class="flex items-center gap-3 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <img [src]="img.url" [alt]="img.alt_text || 'image'" class="h-12 w-12 rounded object-cover" />
                <div class="flex-1">
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ img.alt_text || ('adminUi.products.form.image' | translate) }}</p>
                </div>
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.delete' | translate" (action)="deleteImage(img.id)"></app-button>
              </div>
            </div>
            <p *ngIf="formMessage" class="text-sm text-emerald-700 dark:text-emerald-300">{{ formMessage }}</p>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.categories.title' | translate }}</h2>
            </div>
            <div class="grid md:grid-cols-3 gap-2 items-end text-sm">
              <app-input [label]="'adminUi.products.table.name' | translate" [(value)]="categoryName"></app-input>
              <app-input [label]="'adminUi.categories.slug' | translate" [(value)]="categorySlug"></app-input>
              <app-button size="sm" [label]="'adminUi.categories.add' | translate" (action)="addCategory()"></app-button>
            </div>
            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div
                *ngFor="let cat of categories"
                class="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                draggable="true"
                (dragstart)="onCategoryDragStart(cat.slug)"
                (dragover)="onCategoryDragOver($event)"
                (drop)="onCategoryDrop(cat.slug)"
              >
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ cat.name }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">Slug: {{ cat.slug }} · Order: {{ cat.sort_order }}</p>
                </div>
                <div class="flex gap-2">
                  <app-button size="sm" variant="ghost" label="↑" (action)="moveCategory(cat, -1)"></app-button>
                  <app-button size="sm" variant="ghost" label="↓" (action)="moveCategory(cat, 1)"></app-button>
                  <app-button size="sm" variant="ghost" [label]="'adminUi.actions.delete' | translate" (action)="deleteCategory(cat.slug)"></app-button>
                </div>
              </div>
            </div>
          </section>

          <section *ngIf="false" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.title' | translate }}</h2>
              <label class="text-sm text-slate-700 dark:text-slate-200">
                {{ 'adminUi.orders.statusFilter' | translate }}
                <select class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="orderFilter">
                  <option value="">{{ 'adminUi.orders.all' | translate }}</option>
                  <option value="pending">{{ 'adminUi.orders.pending' | translate }}</option>
                  <option value="paid">{{ 'adminUi.orders.paid' | translate }}</option>
                  <option value="shipped">{{ 'adminUi.orders.shipped' | translate }}</option>
                  <option value="refunded">{{ 'adminUi.orders.refunded' | translate }}</option>
                </select>
              </label>
            </div>
            <div class="grid md:grid-cols-[1.5fr_1fr] gap-4">
              <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                <div *ngFor="let order of filteredOrders()" class="rounded-lg border border-slate-200 p-3 cursor-pointer dark:border-slate-700" (click)="selectOrder(order)">
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-slate-900 dark:text-slate-50">Order #{{ order.id }}</span>
                    <span class="text-xs rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">{{ order.status }}</span>
                  </div>
                  <p>{{ order.customer }} — {{ order.total_amount | localizedCurrency : order.currency || 'RON' }}</p>
                </div>
              </div>
              <div class="rounded-lg border border-slate-200 p-4 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200" *ngIf="activeOrder">
                <div class="flex items-center justify-between">
                  <h3 class="font-semibold text-slate-900 dark:text-slate-50">Order #{{ activeOrder.id }}</h3>
                  <select class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [ngModel]="activeOrder.status" (ngModelChange)="changeOrderStatus($event)">
                    <option value="pending">{{ 'adminUi.orders.pending' | translate }}</option>
                    <option value="paid">{{ 'adminUi.orders.paid' | translate }}</option>
                    <option value="shipped">{{ 'adminUi.orders.shipped' | translate }}</option>
                    <option value="cancelled">{{ 'adminUi.orders.cancelled' | translate }}</option>
                    <option value="refunded">{{ 'adminUi.orders.refunded' | translate }}</option>
                  </select>
                </div>
                <p class="text-xs text-slate-500 dark:text-slate-400">Customer: {{ activeOrder.customer }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">Placed: {{ activeOrder.created_at | date: 'medium' }}</p>
                <p class="font-semibold text-slate-900 dark:text-slate-50 mt-2">{{ activeOrder.total_amount | localizedCurrency : activeOrder.currency || 'RON' }}</p>
              </div>
            </div>
          </section>

          <section *ngIf="false" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.users.title' | translate }}</h2>
              <div class="flex gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.setRole' | translate"
                  [disabled]="!selectedUserId || !selectedUserRole || selectedUserRole === 'owner'"
                  (action)="updateRole()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.forceLogout' | translate"
                  [disabled]="!selectedUserId"
                  (action)="forceLogout()"
                ></app-button>
              </div>
            </div>
            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div *ngFor="let user of users" class="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ userIdentity(user) }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ user.email }}</p>
                </div>
                <div class="flex items-center gap-2 text-xs">
                  <input type="radio" name="userSelect" [value]="user.id" [(ngModel)]="selectedUserId" (ngModelChange)="onSelectedUserIdChange($event)" />
                  <select
                    class="rounded border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [ngModel]="user.role"
                    (ngModelChange)="selectUser(user.id, $event)"
                    [disabled]="user.role === 'owner'"
                  >
                    <option value="customer">{{ 'adminUi.users.roles.customer' | translate }}</option>
                    <option value="admin">{{ 'adminUi.users.roles.admin' | translate }}</option>
                    <option *ngIf="user.role === 'owner'" value="owner">{{ 'adminUi.users.roles.owner' | translate }}</option>
                  </select>
                </div>
              </div>
            </div>

            <div *ngIf="selectedUserId" class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">User aliases</p>
                <app-button size="sm" variant="ghost" label="Refresh" (action)="loadUserAliases(selectedUserId!)"></app-button>
              </div>

              <div *ngIf="userAliasesLoading" class="mt-2 grid gap-2">
                <app-skeleton height="44px"></app-skeleton>
              </div>

              <div *ngIf="userAliasesError" class="mt-2 text-sm text-rose-700 dark:text-rose-300">
                {{ userAliasesError }}
              </div>

              <div *ngIf="userAliases" class="mt-3 grid gap-3 sm:grid-cols-2 text-sm text-slate-700 dark:text-slate-200">
                <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">Username history</p>
                  <ul *ngIf="userAliases.usernames?.length; else noAdminUsernamesTpl" class="mt-2 grid gap-2">
                    <li *ngFor="let h of userAliases.usernames" class="flex items-center justify-between gap-2">
                      <span class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ h.username }}</span>
                      <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ h.created_at | date: 'short' }}</span>
                    </li>
                  </ul>
                  <ng-template #noAdminUsernamesTpl>
                    <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">No history yet.</p>
                  </ng-template>
                </div>
                <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">Display name history</p>
                  <ul *ngIf="userAliases.display_names?.length; else noAdminDisplayNamesTpl" class="mt-2 grid gap-2">
                    <li *ngFor="let h of userAliases.display_names" class="flex items-center justify-between gap-2">
                      <span class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ h.name }}#{{ h.name_tag }}</span>
                      <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ h.created_at | date: 'short' }}</span>
                    </li>
                  </ul>
                  <ng-template #noAdminDisplayNamesTpl>
                    <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">No history yet.</p>
                  </ng-template>
                </div>
              </div>
            </div>
          </section>

          <section *ngIf="section() === 'blog'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.blog.title' | translate }}</h2>
              <div class="flex items-center gap-2">
                <app-button size="sm" variant="ghost" [label]="'adminUi.blog.actions.newPost' | translate" (action)="startBlogCreate()"></app-button>
                <app-button
                  *ngIf="selectedBlogKey"
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.blog.actions.closeEditor' | translate"
                  (action)="closeBlogEditor()"
                ></app-button>
              </div>
            </div>

            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div *ngIf="blogPosts().length === 0" class="text-sm text-slate-500 dark:text-slate-400">
                {{ 'adminUi.blog.empty' | translate }}
              </div>
              <div
                *ngFor="let post of blogPosts()"
                class="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              >
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ post.title }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {{ post.key }} · v{{ post.version }} · {{ post.updated_at | date: 'short' }}
                  </p>
                </div>
                <div class="flex items-center gap-3">
                  <a
                    class="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                    [attr.href]="'/blog/' + extractBlogSlug(post.key)"
                    target="_blank"
                    rel="noopener"
                    (click)="$event.stopPropagation()"
                  >
                    {{ 'adminUi.blog.actions.view' | translate }}
                  </a>
                  <app-button size="sm" variant="ghost" [label]="'adminUi.actions.edit' | translate" (action)="selectBlogPost(post)"></app-button>
                </div>
              </div>
            </div>

            <div *ngIf="showBlogCreate" class="grid gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.blog.create.title' | translate }}</p>
              <div class="grid md:grid-cols-2 gap-3 text-sm">
                <app-input
                  [label]="'adminUi.blog.fields.slug' | translate"
                  [(value)]="blogCreate.slug"
                  [placeholder]="'adminUi.blog.fields.slugPlaceholder' | translate"
                ></app-input>
                <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.fields.baseLanguage' | translate }}
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.baseLang"
                  >
                    <option value="en">EN</option>
                    <option value="ro">RO</option>
                  </select>
                </label>
                <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.fields.status' | translate }}
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.status"
                  >
                    <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                    <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                  </select>
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.fields.publishAtOptional' | translate }}
                  <input
                    type="datetime-local"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.published_at"
                  />
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.fields.publishAtHint' | translate }}
                  </span>
                </label>
                <div class="md:col-span-2">
                  <app-input [label]="'adminUi.blog.fields.title' | translate" [(value)]="blogCreate.title"></app-input>
                </div>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  {{ 'adminUi.blog.fields.summaryOptional' | translate }}
                  <textarea
                    rows="3"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.summary"
                  ></textarea>
                </label>
                <app-input
                  [label]="'adminUi.blog.fields.tags' | translate"
                  [(value)]="blogCreate.tags"
                  [placeholder]="'adminUi.blog.fields.tagsPlaceholder' | translate"
                ></app-input>
                <app-input
                  [label]="'adminUi.blog.fields.coverImageUrlOptional' | translate"
                  [(value)]="blogCreate.cover_image_url"
                  [placeholder]="'adminUi.blog.fields.coverImagePlaceholder' | translate"
                ></app-input>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.fields.readingTimeOptional' | translate }}
                  <input
                    type="number"
                    min="1"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.reading_time_minutes"
                  />
                </label>
                <div class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  {{ 'adminUi.blog.fields.body' | translate }}
                  <app-rich-editor
                    [(value)]="blogCreate.body_markdown"
                    [initialEditType]="'wysiwyg'"
                    [height]="'420px'"
                  ></app-rich-editor>
                </div>
              </div>

              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" [(ngModel)]="blogCreate.includeTranslation" />
                {{ 'adminUi.blog.create.addTranslation' | translate }}
              </label>

              <div *ngIf="blogCreate.includeTranslation" class="grid md:grid-cols-2 gap-3 text-sm">
                <p class="md:col-span-2 text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.create.translationHint' | translate: { lang: blogCreate.baseLang === 'en' ? 'RO' : 'EN' } }}
                </p>
                <app-input [label]="'adminUi.blog.create.translationTitle' | translate" [(value)]="blogCreate.translationTitle"></app-input>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  {{ 'adminUi.blog.create.translationBody' | translate }}
                  <textarea
                    rows="5"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.translationBody"
                  ></textarea>
                </label>
              </div>

              <div class="flex gap-2">
                <app-button [label]="'adminUi.blog.actions.createPost' | translate" (action)="createBlogPost()"></app-button>
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.cancel' | translate" (action)="cancelBlogCreate()"></app-button>
              </div>
            </div>

            <div *ngIf="selectedBlogKey" class="grid gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="grid gap-1">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {{ 'adminUi.blog.editing.title' | translate }}: {{ selectedBlogKey }}
                  </p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.editing.languages' | translate: { base: blogBaseLang.toUpperCase(), edit: blogEditLang.toUpperCase() } }}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <app-button
                    size="sm"
                    variant="ghost"
                    label="EN"
                    [disabled]="blogEditLang === 'en'"
                    (action)="setBlogEditLang('en')"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    label="RO"
                    [disabled]="blogEditLang === 'ro'"
                    (action)="setBlogEditLang('ro')"
                  ></app-button>
                </div>
              </div>

              <div class="grid md:grid-cols-2 gap-3 text-sm">
                <app-input [label]="'adminUi.blog.fields.title' | translate" [(value)]="blogForm.title"></app-input>
                <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.editing.statusBaseOnly' | translate }}
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.status"
                    [disabled]="blogEditLang !== blogBaseLang"
                  >
                    <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                    <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                  </select>
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  {{ 'adminUi.blog.editing.publishAtBaseOnlyOptional' | translate }}
                  <input
                    type="datetime-local"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.published_at"
                    [disabled]="blogEditLang !== blogBaseLang"
                  />
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.editing.publishAtBaseOnlyHint' | translate }}
                  </span>
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  {{ 'adminUi.blog.editing.summaryOptional' | translate: { lang: blogEditLang.toUpperCase() } }}
                  <textarea
                    rows="3"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.summary"
                  ></textarea>
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.editing.summaryHint' | translate }}
                  </span>
                </label>
                <app-input
                  [label]="'adminUi.blog.fields.tags' | translate"
                  [(value)]="blogForm.tags"
                  [placeholder]="'adminUi.blog.fields.tagsPlaceholder' | translate"
                ></app-input>
                <app-input
                  [label]="'adminUi.blog.fields.coverImageUrlOptional' | translate"
                  [(value)]="blogForm.cover_image_url"
                  [placeholder]="'adminUi.blog.fields.coverImagePlaceholder' | translate"
                ></app-input>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.fields.readingTimeOptional' | translate }}
                  <input
                    type="number"
                    min="1"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.reading_time_minutes"
                  />
                </label>
                <div class="grid gap-2 md:col-span-2">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <p class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ 'adminUi.blog.fields.body' | translate }}</p>
                    <div class="flex flex-wrap items-center gap-3">
                      <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <input type="checkbox" [(ngModel)]="useRichBlogEditor" />
                        {{ 'adminUi.blog.editing.richEditor' | translate }}
                      </label>
                      <label *ngIf="!useRichBlogEditor" class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <input type="checkbox" [(ngModel)]="showBlogPreview" />
                        {{ 'adminUi.blog.editing.livePreview' | translate }}
                      </label>
                    </div>
                  </div>

                  <ng-container *ngIf="useRichBlogEditor; else markdownBlogEditor">
                    <div class="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="blogImageInputRich.click()"
                      >
                        {{ 'adminUi.blog.actions.image' | translate }}
                      </button>
                      <input
                        #blogImageInputRich
                        type="file"
                        accept="image/*"
                        class="hidden"
                        (change)="uploadAndInsertBlogImage(blogEditor, $event)"
                      />
                    </div>

                    <app-rich-editor
                      #blogEditor
                      [(value)]="blogForm.body_markdown"
                      [initialEditType]="'wysiwyg'"
                      [height]="'520px'"
                    ></app-rich-editor>
                  </ng-container>

                  <ng-template #markdownBlogEditor>
                    <div class="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="applyBlogHeading(blogBody, 1)"
                      >
                        H1
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="applyBlogHeading(blogBody, 2)"
                      >
                        H2
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="wrapBlogSelection(blogBody, '**', '**', 'bold text')"
                      >
                        B
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 italic text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="wrapBlogSelection(blogBody, '*', '*', 'italic text')"
                      >
                        I
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="insertBlogLink(blogBody)"
                      >
                        {{ 'adminUi.blog.toolbar.link' | translate }}
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="insertBlogCodeBlock(blogBody)"
                      >
                        {{ 'adminUi.blog.toolbar.code' | translate }}
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="applyBlogList(blogBody)"
                      >
                        {{ 'adminUi.blog.toolbar.list' | translate }}
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="blogImageInput.click()"
                      >
                        {{ 'adminUi.blog.actions.image' | translate }}
                      </button>
                      <input #blogImageInput type="file" accept="image/*" class="hidden" (change)="uploadAndInsertBlogImage(blogBody, $event)" />
                    </div>

                    <textarea
                      #blogBody
                      rows="10"
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="blogForm.body_markdown"
                    ></textarea>

                    <div
                      *ngIf="showBlogPreview"
                      class="markdown rounded-lg border border-slate-200 p-3 bg-slate-50 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200"
                      [innerHTML]="renderMarkdown(blogForm.body_markdown || ('adminUi.blog.editing.previewEmpty' | translate))"
                    ></div>
                  </ng-template>
                </div>
              </div>

              <div class="grid gap-2">
                <div *ngIf="blogImages.length" class="grid gap-2">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.blog.images.title' | translate }}</p>
                  <div *ngFor="let img of blogImages" class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <a class="text-xs text-indigo-600 dark:text-indigo-300 hover:underline truncate" [href]="img.url" target="_blank" rel="noopener">
                      {{ img.url }}
                    </a>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.blog.images.insertMarkdown' | translate"
                      (action)="insertBlogImageMarkdown(img.url, img.alt_text)"
                    ></app-button>
                  </div>
                </div>
              </div>

              <div class="flex flex-wrap gap-2">
                <app-button [label]="'adminUi.actions.save' | translate" (action)="saveBlogPost()"></app-button>
                <app-button size="sm" variant="ghost" [label]="'adminUi.blog.actions.previewLink' | translate" (action)="generateBlogPreviewLink()"></app-button>
                <a
                  class="inline-flex items-center justify-center rounded-full font-semibold transition px-3 py-2 text-sm bg-white text-slate-900 border border-slate-200 hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:bg-slate-800 dark:text-slate-50 dark:border-slate-700 dark:hover:border-slate-600"
                  [attr.href]="'/blog/' + currentBlogSlug()"
                  target="_blank"
                  rel="noopener"
                >
                  {{ 'adminUi.blog.actions.view' | translate }}
                </a>
              </div>
              <div *ngIf="blogPreviewUrl" class="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-950/30">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.blog.preview.title' | translate }}</p>
                <div class="flex items-center gap-2">
                  <input
                    class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [value]="blogPreviewUrl"
                    readonly
                  />
                  <app-button size="sm" variant="ghost" [label]="'adminUi.blog.actions.copy' | translate" (action)="copyBlogPreviewLink()"></app-button>
                </div>
                <p *ngIf="blogPreviewExpiresAt" class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.preview.expires' | translate }} {{ blogPreviewExpiresAt | date: 'short' }}
                </p>
              </div>
              <div class="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.blog.revisions.title' | translate }}</p>
                  <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadBlogVersions()"></app-button>
                </div>
                <div *ngIf="blogVersions.length === 0" class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.revisions.empty' | translate }}
                </div>
                <div *ngFor="let v of blogVersions" class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div>
                    <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">v{{ v.version }} · {{ v.created_at | date: 'short' }}</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">{{ v.status }}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <app-button size="sm" variant="ghost" [label]="'adminUi.blog.revisions.diff' | translate" (action)="selectBlogVersion(v.version)"></app-button>
                    <app-button size="sm" variant="ghost" [label]="'adminUi.blog.revisions.rollback' | translate" (action)="rollbackBlogVersion(v.version)"></app-button>
                  </div>
                </div>

                <div *ngIf="blogVersionDetail" class="grid gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.revisions.diffVsCurrent' | translate: { version: blogVersionDetail.version } }}
                  </p>
                  <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs whitespace-pre-wrap text-slate-900 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-100">
                    <ng-container *ngFor="let part of blogDiffParts">
                      <span
                        [ngClass]="part.added ? 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100' : part.removed ? 'bg-rose-200 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100' : ''"
                        >{{ part.value }}</span
                      >
                    </ng-container>
                  </div>
                </div>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.blog.editing.toolbarTip' | translate }}</p>
	            </div>
	          </section>

	          <section *ngIf="section() === 'blog'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	            <div class="flex items-center justify-between">
	              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.blog.moderation.title' | translate }}</h2>
	              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadFlaggedComments()"></app-button>
	            </div>
	            <div
	              *ngIf="flaggedCommentsError"
	              class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
	            >
	              {{ flaggedCommentsError }}
	            </div>
	            <div *ngIf="flaggedCommentsLoading()" class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.blog.moderation.loading' | translate }}</div>
	            <div
	              *ngIf="!flaggedCommentsLoading() && !flaggedCommentsError && flaggedComments().length === 0"
	              class="text-sm text-slate-500 dark:text-slate-400"
	            >
	              {{ 'adminUi.blog.moderation.empty' | translate }}
	            </div>
	            <div *ngIf="!flaggedCommentsLoading() && flaggedComments().length" class="grid gap-3">
	              <div *ngFor="let c of flaggedComments()" class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
	                <div class="flex items-start justify-between gap-3">
	                  <div class="grid gap-0.5">
	                    <p class="font-semibold text-slate-900 dark:text-slate-50">{{ commentAuthorLabel(c.author) }}</p>
	                    <p class="text-xs text-slate-500 dark:text-slate-400">
	                      /blog/{{ c.post_slug }} · {{ c.created_at | date: 'short' }} · {{ 'adminUi.blog.moderation.flagsCount' | translate: { count: c.flag_count } }}
	                    </p>
	                  </div>
	                  <div class="flex items-center gap-2">
	                    <a
	                      class="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
	                      [attr.href]="'/blog/' + c.post_slug"
	                      target="_blank"
	                      rel="noopener"
	                      (click)="$event.stopPropagation()"
	                    >
	                      {{ 'adminUi.blog.actions.view' | translate }}
	                    </a>
	                    <app-button size="sm" variant="ghost" [label]="'adminUi.blog.moderation.actions.resolve' | translate" (action)="resolveFlags(c)"></app-button>
	                    <app-button size="sm" variant="ghost" [label]="c.is_hidden ? ('adminUi.blog.moderation.actions.unhide' | translate) : ('adminUi.blog.moderation.actions.hide' | translate)" (action)="toggleHide(c)"></app-button>
	                    <app-button size="sm" variant="ghost" [label]="'adminUi.actions.delete' | translate" (action)="adminDeleteComment(c)"></app-button>
	                  </div>
	                </div>
	                <p class="mt-2 text-sm whitespace-pre-line text-slate-700 dark:text-slate-200">
	                  {{ c.body || ('adminUi.blog.moderation.deletedBody' | translate) }}
	                </p>
	                <div *ngIf="c.flags?.length" class="mt-2 grid gap-1 text-xs text-slate-600 dark:text-slate-300">
	                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.blog.moderation.flagsTitle' | translate }}</p>
	                  <div *ngFor="let f of c.flags" class="flex items-center justify-between gap-2">
	                    <span>{{ f.reason || '—' }}</span>
	                    <span class="text-slate-500 dark:text-slate-400">{{ f.created_at | date: 'short' }}</span>
	                  </div>
	                </div>
	              </div>
	            </div>
	          </section>

	          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	            <div class="flex items-center justify-between">
	              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.content.title' | translate }}</h2>
	            </div>
            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div *ngFor="let c of contentBlocks" class="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ c.title }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ c.key }} · v{{ c.version }} · {{ c.updated_at | date: 'short' }}</p>
                </div>
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.edit' | translate" (action)="selectContent(c)"></app-button>
              </div>
            </div>
            <div *ngIf="selectedContent" class="grid gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.content.editing' | translate }}: {{ selectedContent.key }}</p>
              <app-input [label]="'adminUi.content.titleLabel' | translate" [(value)]="contentForm.title"></app-input>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.content.status' | translate }}
                <select class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="contentForm.status">
                  <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                  <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                </select>
              </label>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.content.body' | translate }}
                <textarea rows="4" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="contentForm.body_markdown"></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" [label]="'adminUi.content.save' | translate" (action)="saveContent()"></app-button>
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.cancel' | translate" (action)="cancelContent()"></app-button>
                <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" [(ngModel)]="showContentPreview" /> {{ 'adminUi.content.livePreview' | translate }}
                </label>
              </div>
              <div *ngIf="showContentPreview" class="rounded-lg border border-slate-200 p-3 bg-slate-50 text-sm text-slate-800 whitespace-pre-line dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200">
                {{ contentForm.body_markdown || ('adminUi.content.previewEmpty' | translate) }}
              </div>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.coupons.title' | translate }}</h2>
            </div>
            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div class="grid md:grid-cols-3 gap-2 items-end">
                <app-input [label]="'adminUi.coupons.code' | translate" [(value)]="newCoupon.code"></app-input>
                <app-input [label]="'adminUi.coupons.percentOff' | translate" type="number" [(value)]="newCoupon.percentage_off"></app-input>
                <app-button size="sm" [label]="'adminUi.coupons.add' | translate" (action)="createCoupon()"></app-button>
              </div>
              <div *ngFor="let coupon of coupons" class="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ coupon.code }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    <ng-container *ngIf="coupon.percentage_off">-{{ coupon.percentage_off }}%</ng-container>
                    <ng-container *ngIf="coupon.amount_off">-{{ coupon.amount_off | localizedCurrency : coupon.currency || 'RON' }}</ng-container>
                    <ng-container *ngIf="!coupon.percentage_off && !coupon.amount_off">{{ 'adminUi.coupons.none' | translate }}</ng-container>
                  </p>
                </div>
                <button
                  type="button"
                  class="text-xs rounded-full px-2 py-1 border border-slate-200 dark:border-slate-700"
                  [class.bg-emerald-100]="coupon.active"
                  [class.text-emerald-800]="coupon.active"
                  (click)="toggleCoupon(coupon)"
                >
                  {{ coupon.active ? ('adminUi.coupons.active' | translate) : ('adminUi.coupons.inactive' | translate) }}
                </button>
              </div>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div class="grid gap-0.5">
                <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.fx.title' | translate }}</h2>
                <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.fx.hint' | translate }}</p>
              </div>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadFxStatus()"></app-button>
            </div>

            <div
              *ngIf="fxError()"
              class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
            >
              {{ fxError() }}
            </div>
            <div *ngIf="fxLoading()" class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.fx.loading' | translate }}</div>

            <div *ngIf="fxStatus() as fx" class="grid gap-4 md:grid-cols-3 text-sm text-slate-700 dark:text-slate-200">
              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.fx.effective' | translate }}
                </p>
                <div class="mt-2 grid gap-1">
                  <div class="flex items-center justify-between gap-3">
                    <span>{{ 'adminUi.fx.eurPerRon' | translate }}</span>
                    <span class="font-medium text-slate-900 dark:text-slate-50">{{ fx.effective.eur_per_ron | number: '1.4-6' }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span>{{ 'adminUi.fx.usdPerRon' | translate }}</span>
                    <span class="font-medium text-slate-900 dark:text-slate-50">{{ fx.effective.usd_per_ron | number: '1.4-6' }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span>{{ 'adminUi.fx.asOf' | translate }}</span>
                    <span class="text-slate-600 dark:text-slate-300">{{ fx.effective.as_of }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span>{{ 'adminUi.fx.fetchedAt' | translate }}</span>
                    <span class="text-slate-600 dark:text-slate-300">{{ fx.effective.fetched_at | date: 'short' }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span>{{ 'adminUi.fx.source' | translate }}</span>
                    <span class="text-slate-600 dark:text-slate-300">{{ fx.effective.source }}</span>
                  </div>
                </div>
              </div>

              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div class="flex items-center justify-between gap-3">
                  <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.fx.override' | translate }}
                  </p>
                  <button
                    *ngIf="fx.override"
                    type="button"
                    class="text-xs font-medium text-rose-600 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-200"
                    (click)="clearFxOverride()"
                  >
                    {{ 'adminUi.fx.actions.clear' | translate }}
                  </button>
                </div>

                <ng-container *ngIf="fx.override; else noOverrideTpl">
                  <div class="mt-2 grid gap-1">
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.eurPerRon' | translate }}</span>
                      <span class="font-medium text-slate-900 dark:text-slate-50">{{ fx.override?.eur_per_ron | number: '1.4-6' }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.usdPerRon' | translate }}</span>
                      <span class="font-medium text-slate-900 dark:text-slate-50">{{ fx.override?.usd_per_ron | number: '1.4-6' }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.asOf' | translate }}</span>
                      <span class="text-slate-600 dark:text-slate-300">{{ fx.override?.as_of }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.fetchedAt' | translate }}</span>
                      <span class="text-slate-600 dark:text-slate-300">{{ fx.override?.fetched_at | date: 'short' }}</span>
                    </div>
                  </div>
                </ng-container>
                <ng-template #noOverrideTpl>
                  <p class="mt-2 text-slate-500 dark:text-slate-400">{{ 'adminUi.fx.noOverride' | translate }}</p>
                </ng-template>

                <div class="mt-4 grid gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <div class="grid gap-2 sm:grid-cols-2">
                    <app-input [label]="'adminUi.fx.eurPerRon' | translate" type="number" [(value)]="fxOverrideForm.eur_per_ron"></app-input>
                    <app-input [label]="'adminUi.fx.usdPerRon' | translate" type="number" [(value)]="fxOverrideForm.usd_per_ron"></app-input>
                  </div>
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <span>{{ 'adminUi.fx.asOf' | translate }}</span>
                    <input
                      type="date"
                      class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                      [(ngModel)]="fxOverrideForm.as_of"
                    />
                    <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.fx.asOfHint' | translate }}</span>
                  </label>
                  <div class="flex flex-wrap items-center gap-2">
                    <app-button size="sm" [label]="'adminUi.fx.actions.set' | translate" (action)="saveFxOverride()"></app-button>
                    <app-button size="sm" variant="ghost" [label]="'adminUi.fx.actions.reset' | translate" (action)="resetFxOverrideForm()"></app-button>
                  </div>
                </div>
              </div>

              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.fx.lastKnown' | translate }}
                </p>
                <ng-container *ngIf="fx.last_known; else noLastKnownTpl">
                  <div class="mt-2 grid gap-1">
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.eurPerRon' | translate }}</span>
                      <span class="font-medium text-slate-900 dark:text-slate-50">{{ fx.last_known?.eur_per_ron | number: '1.4-6' }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.usdPerRon' | translate }}</span>
                      <span class="font-medium text-slate-900 dark:text-slate-50">{{ fx.last_known?.usd_per_ron | number: '1.4-6' }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.asOf' | translate }}</span>
                      <span class="text-slate-600 dark:text-slate-300">{{ fx.last_known?.as_of }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.fetchedAt' | translate }}</span>
                      <span class="text-slate-600 dark:text-slate-300">{{ fx.last_known?.fetched_at | date: 'short' }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.source' | translate }}</span>
                      <span class="text-slate-600 dark:text-slate-300">{{ fx.last_known?.source }}</span>
                    </div>
                  </div>
                </ng-container>
                <ng-template #noLastKnownTpl>
                  <p class="mt-2 text-slate-500 dark:text-slate-400">{{ 'adminUi.fx.noLastKnown' | translate }}</p>
                </ng-template>
              </div>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.audit.title' | translate }}</h2>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadAudit()"></app-button>
            </div>
            <div class="grid md:grid-cols-3 gap-4 text-sm text-slate-700 dark:text-slate-200">
              <div class="grid gap-2">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.products' | translate }}</p>
                <div *ngFor="let log of productAudit" class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ log.action }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.productId' | translate }} {{ log.product_id }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.at' | translate }} {{ log.created_at | date: 'short' }}</p>
                </div>
              </div>
              <div class="grid gap-2">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.content' | translate }}</p>
                <div *ngFor="let log of contentAudit" class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ log.action }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.blockId' | translate }} {{ log.block_id }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.at' | translate }} {{ log.created_at | date: 'short' }}</p>
                </div>
              </div>
              <div class="grid gap-2">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.security' | translate }}</p>
                <div *ngFor="let log of securityAudit" class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ ('adminUi.audit.securityActions.' + log.action) | translate }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.audit.actor' | translate }} {{ log.actor_email || log.actor_user_id }}
                  </p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.audit.subject' | translate }} {{ log.subject_email || log.data?.identifier || log.subject_user_id }}
                  </p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.at' | translate }} {{ log.created_at | date: 'short' }}</p>
                </div>
              </div>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.maintenance.title' | translate }}</h2>
              <app-button size="sm" [label]="'adminUi.actions.save' | translate" (action)="saveMaintenance()"></app-button>
            </div>
            <div class="flex items-center gap-3 text-sm">
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="maintenanceEnabledValue" /> {{ 'adminUi.maintenance.mode' | translate }}
              </label>
              <a class="text-indigo-600 dark:text-indigo-300" href="/api/v1/sitemap.xml" target="_blank" rel="noopener">{{ 'adminUi.maintenance.sitemap' | translate }}</a>
              <a class="text-indigo-600 dark:text-indigo-300" href="/api/v1/robots.txt" target="_blank" rel="noopener">{{ 'adminUi.maintenance.robots' | translate }}</a>
              <a class="text-indigo-600 dark:text-indigo-300" href="/api/v1/feeds/products.json" target="_blank" rel="noopener">{{ 'adminUi.maintenance.feed' | translate }}</a>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.lowStock.title' | translate }}</h2>
              <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.lowStock.hint' | translate }}</span>
            </div>
            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div *ngFor="let item of lowStock" class="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ item.name }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ item.sku }} — {{ item.slug }}</p>
                </div>
                <span class="text-xs rounded-full bg-amber-100 px-2 py-1 text-amber-900">{{ 'adminUi.lowStock.stock' | translate:{count: item.stock_quantity} }}</span>
              </div>
            </div>
          </section>
        </div>
	        <ng-template #loadingTpl>
	          <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	            <app-skeleton [rows]="6"></app-skeleton>
	          </div>
	        </ng-template>
	      </div>
	  `
})
export class AdminComponent implements OnInit {
  crumbs = [
    { label: 'adminUi.nav.content', url: '/admin/content' },
    { label: 'adminUi.content.nav.home' }
  ];

  section = signal<AdminContentSection>('home');

  private readonly contentVersions: Record<string, number> = {};

  summary = signal<AdminSummary | null>(null);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);

  products: AdminProduct[] = [];
  categories: AdminCategory[] = [];
  categoryName = '';
  categorySlug = '';
  maintenanceEnabledValue = false;
  maintenanceEnabled = signal<boolean>(false);
  draggingSlug: string | null = null;
  selectedIds = new Set<string>();
  allSelected = false;
  sectionOrder: string[] = ['hero', 'featured_products', 'new_arrivals', 'featured_collections', 'story', 'recently_viewed', 'why'];
  sectionEnabled: Record<string, boolean> = {};
  draggingSection: string | null = null;
  sectionsMessage = '';

  heroLang = 'en';
  heroForm = {
    title: '',
    subtitle: '',
    cta_label: '',
    cta_url: '',
    image: ''
  };
  heroMessage = signal<string | null>(null);
  heroError = signal<string | null>(null);

  featuredCollections: FeaturedCollection[] = [];
  collectionForm: { slug: string; name: string; description?: string | null; product_ids: string[] } = {
    slug: '',
    name: '',
    description: '',
    product_ids: []
  };
  editingCollection: string | null = null;
  collectionMessage = '';

  formMessage = '';
  editingId: string | null = null;
  productDetail: AdminProductDetail | null = null;
  productImages = signal<{ id: string; url: string; alt_text?: string | null }[]>([]);
  form = {
    name: '',
    slug: '',
    category_id: '',
    price: 0,
    stock: 0,
    status: 'draft',
    sku: '',
    image: '',
    description: '',
    publish_at: '',
    is_bestseller: false,
    is_highlight: false
  };

  orders: AdminOrder[] = [];
  activeOrder: AdminOrder | null = null;
  orderFilter = '';

  users: AdminUser[] = [];
  selectedUserId: string | null = null;
  selectedUserRole: string | null = null;
  userAliases: AdminUserAliasesResponse | null = null;
  userAliasesLoading = false;
  userAliasesError: string | null = null;

  contentBlocks: AdminContent[] = [];
  selectedContent: AdminContent | null = null;
  contentForm = {
    title: '',
    body_markdown: '',
    status: 'draft'
  };
  showContentPreview = false;

  showBlogCreate = false;
  blogCreate: {
    slug: string;
    baseLang: 'en' | 'ro';
    status: 'draft' | 'published';
    published_at: string;
    title: string;
    body_markdown: string;
    summary: string;
    tags: string;
    cover_image_url: string;
    reading_time_minutes: string;
    includeTranslation: boolean;
    translationTitle: string;
    translationBody: string;
  } = {
    slug: '',
    baseLang: 'en',
    status: 'draft',
    published_at: '',
    title: '',
    body_markdown: '',
    summary: '',
    tags: '',
    cover_image_url: '',
    reading_time_minutes: '',
    includeTranslation: false,
    translationTitle: '',
    translationBody: ''
  };
  selectedBlogKey: string | null = null;
  blogBaseLang: 'en' | 'ro' = 'en';
  blogEditLang: 'en' | 'ro' = 'en';
  blogForm = {
    title: '',
    body_markdown: '',
    status: 'draft',
    published_at: '',
    summary: '',
    tags: '',
    cover_image_url: '',
    reading_time_minutes: ''
  };
  blogMeta: Record<string, any> = {};
  blogImages: { id: string; url: string; alt_text?: string | null }[] = [];
  showBlogPreview = false;
  useRichBlogEditor = true;
  blogPreviewUrl: string | null = null;
  blogPreviewExpiresAt: string | null = null;
  blogVersions: ContentBlockVersionListItem[] = [];
  blogVersionDetail: ContentBlockVersionRead | null = null;
  blogDiffParts: { value: string; added?: boolean; removed?: boolean }[] = [];
  flaggedComments = signal<AdminBlogComment[]>([]);
  flaggedCommentsLoading = signal<boolean>(false);
  flaggedCommentsError: string | null = null;

  assetsForm = { logo_url: '', favicon_url: '', social_image_url: '' };
  assetsMessage: string | null = null;
  assetsError: string | null = null;
  socialForm: {
    phone: string;
    email: string;
    instagram_pages: Array<{ label: string; url: string; thumbnail_url: string }>;
    facebook_pages: Array<{ label: string; url: string; thumbnail_url: string }>;
  } = {
    phone: '+40723204204',
    email: 'momentstudio.ro@gmail.com',
    instagram_pages: [
      { label: 'Moments in Clay - Studio', url: 'https://www.instagram.com/moments_in_clay_studio?igsh=ZmdnZTdudnNieDQx', thumbnail_url: '' },
      { label: 'momentstudio', url: 'https://www.instagram.com/adrianaartizanat?igsh=ZmZmaDU1MGcxZHEy', thumbnail_url: '' }
    ],
    facebook_pages: [
      { label: 'Moments in Clay - Studio', url: 'https://www.facebook.com/share/17YqBmfX5x/', thumbnail_url: '' },
      { label: 'momentstudio', url: 'https://www.facebook.com/share/1APqKJM6Zi/', thumbnail_url: '' }
    ]
  };
  socialMessage: string | null = null;
  socialError: string | null = null;
  socialThumbLoading: Record<string, boolean> = {};
  socialThumbErrors: Record<string, string> = {};
  seoLang: 'en' | 'ro' = 'en';
  seoPage: 'home' | 'shop' | 'product' | 'category' | 'about' = 'home';
  seoForm = { title: '', description: '' };
  seoMessage: string | null = null;
  seoError: string | null = null;
  infoLang: 'en' | 'ro' = 'en';
  infoForm = { about: '', faq: '', shipping: '', contact: '' };
  infoMessage: string | null = null;
  infoError: string | null = null;
  coupons: AdminCoupon[] = [];
  newCoupon: Partial<AdminCoupon> = { code: '', percentage_off: 0, active: true, currency: 'RON' };
  stockEdits: Record<string, number> = {};
  bulkStock: number | null = null;

  fxStatus = signal<FxAdminStatus | null>(null);
  fxLoading = signal<boolean>(false);
  fxError = signal<string | null>(null);
  fxOverrideForm: { eur_per_ron: number; usd_per_ron: number; as_of: string } = { eur_per_ron: 0, usd_per_ron: 0, as_of: '' };

  productAudit: AdminAudit['products'] = [];
  contentAudit: AdminAudit['content'] = [];
  securityAudit: NonNullable<AdminAudit['security']> = [];
  lowStock: LowStockItem[] = [];

  ownerTransferIdentifier = '';
  ownerTransferConfirm = '';
  ownerTransferPassword = '';
  ownerTransferLoading = false;
  ownerTransferError: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private admin: AdminService,
    private blog: BlogService,
    private fxAdmin: FxAdminService,
    private auth: AuthService,
    private toast: ToastService,
    private translate: TranslateService,
    private markdown: MarkdownService
  ) {}

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  private rememberContentVersion(key: string, block: { version?: number } | null | undefined): void {
    const version = block?.version;
    if (typeof version === 'number' && Number.isFinite(version) && version > 0) {
      this.contentVersions[key] = version;
    }
  }

  private expectedVersion(key: string): number | undefined {
    const version = this.contentVersions[key];
    return typeof version === 'number' && Number.isFinite(version) && version > 0 ? version : undefined;
  }

  private withExpectedVersion<T extends Record<string, unknown>>(key: string, payload: T): T & { expected_version?: number } {
    const expected = this.expectedVersion(key);
    return expected ? { ...payload, expected_version: expected } : payload;
  }

  private handleContentConflict(err: any, key: string, reload: () => void): boolean {
    if (err?.status !== 409) return false;
    this.toast.error(this.t('adminUi.content.errors.conflictTitle'), this.t('adminUi.content.errors.conflictCopy'));
    delete this.contentVersions[key];
    reload();
    return true;
  }

  isOwner(): boolean {
    return this.auth.role() === 'owner';
  }

  ngOnInit(): void {
    this.route.data.subscribe((data) => {
      const next = this.normalizeSection(data['section']);
      this.applySection(next);
    });
  }

  loadAll(): void {
    this.loadForSection(this.section());
  }

  private normalizeSection(value: unknown): AdminContentSection {
    if (value === 'home' || value === 'pages' || value === 'blog' || value === 'settings') return value;
    return 'home';
  }

  private applySection(next: AdminContentSection): void {
    if (this.section() === next) {
      this.loadForSection(next);
      return;
    }
    this.section.set(next);
    this.crumbs = [
      { label: 'adminUi.nav.content', url: '/admin/content' },
      { label: `adminUi.content.nav.${next}` }
    ];
    this.resetSectionState(next);
    this.loadForSection(next);
  }

  private resetSectionState(next: AdminContentSection): void {
    this.error.set(null);
    if (next !== 'blog') {
      this.closeBlogEditor();
      this.showBlogCreate = false;
      this.flaggedComments.set([]);
      this.flaggedCommentsError = null;
    }
    if (next !== 'settings') {
      this.selectedContent = null;
      this.showContentPreview = false;
    }
  }

  private loadForSection(section: AdminContentSection): void {
    this.loading.set(true);
    this.error.set(null);

    if (section === 'home') {
      this.admin.products().subscribe({ next: (p) => (this.products = p), error: () => (this.products = []) });
      this.loadHero(this.heroLang);
      this.loadSections();
      this.loadCollections();
      this.loading.set(false);
      return;
    }

    if (section === 'pages') {
      this.loadInfo();
      this.loading.set(false);
      return;
    }

    if (section === 'blog') {
      this.admin.content().subscribe({ next: (c) => (this.contentBlocks = c), error: () => (this.contentBlocks = []) });
      this.loadFlaggedComments();
      this.loading.set(false);
      return;
    }

    // settings
    this.admin.content().subscribe({ next: (c) => (this.contentBlocks = c), error: () => (this.contentBlocks = []) });
    this.admin.coupons().subscribe({ next: (c) => (this.coupons = c), error: () => (this.coupons = []) });
    this.admin.lowStock().subscribe({ next: (items) => (this.lowStock = items), error: () => (this.lowStock = []) });
    this.admin.audit().subscribe({
      next: (logs) => {
        this.productAudit = logs.products;
        this.contentAudit = logs.content;
        this.securityAudit = logs.security ?? [];
      },
      error: () => this.toast.error(this.t('adminUi.audit.errors.loadTitle'), this.t('adminUi.audit.errors.loadCopy'))
    });
    this.admin.getCategories().subscribe({
      next: (cats) => {
        this.categories = cats
          .map((c) => ({ ...c, sort_order: c.sort_order ?? 0 }))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      },
      error: () => (this.categories = [])
    });
    this.loadAssets();
    this.loadSocial();
    this.loadSeo();
    this.loadFxStatus();
    this.admin.getMaintenance().subscribe({
      next: (m) => {
        this.maintenanceEnabled.set(m.enabled);
        this.maintenanceEnabledValue = m.enabled;
      }
    });
    this.loading.set(false);
  }

  loadAudit(): void {
    this.admin.audit().subscribe({
      next: (logs) => {
        this.productAudit = logs.products;
        this.contentAudit = logs.content;
        this.securityAudit = logs.security ?? [];
      },
      error: () => {
        this.toast.error(this.t('adminUi.audit.errors.loadTitle'), this.t('adminUi.audit.errors.loadCopy'));
      }
    });
  }

  submitOwnerTransfer(): void {
    if (!this.isOwner()) return;
    this.ownerTransferError = null;
    const identifier = this.ownerTransferIdentifier.trim();
    const confirm = this.ownerTransferConfirm.trim();
    const password = this.ownerTransferPassword;
    if (!identifier) {
      this.ownerTransferError = this.t('adminUi.ownerTransfer.errors.identifier');
      return;
    }
    this.ownerTransferLoading = true;
    this.admin.transferOwner({ identifier, confirm, password }).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.ownerTransfer.successTitle'), this.t('adminUi.ownerTransfer.successCopy'));
        this.ownerTransferPassword = '';
        this.ownerTransferConfirm = '';
        this.ownerTransferIdentifier = '';
        this.auth.loadCurrentUser().subscribe();
        this.loadAudit();
      },
      error: (err) => {
        const detail = err?.error?.detail;
        this.ownerTransferError = typeof detail === 'string' && detail ? detail : this.t('adminUi.ownerTransfer.errors.generic');
        this.ownerTransferLoading = false;
      },
      complete: () => {
        this.ownerTransferLoading = false;
      }
    });
  }

  loadFxStatus(): void {
    this.fxLoading.set(true);
    this.fxError.set(null);
    this.fxAdmin.getStatus().subscribe({
      next: (status) => {
        this.fxStatus.set(status);
        const current = status.override ?? status.effective;
        this.fxOverrideForm = {
          eur_per_ron: Number(current.eur_per_ron) || 0,
          usd_per_ron: Number(current.usd_per_ron) || 0,
          as_of: current.as_of || ''
        };
      },
      error: () => {
        this.fxError.set(this.t('adminUi.fx.errors.load'));
      },
      complete: () => {
        this.fxLoading.set(false);
      }
    });
  }

  resetFxOverrideForm(): void {
    const status = this.fxStatus();
    if (!status) return;
    const current = status.override ?? status.effective;
    this.fxOverrideForm = {
      eur_per_ron: Number(current.eur_per_ron) || 0,
      usd_per_ron: Number(current.usd_per_ron) || 0,
      as_of: current.as_of || ''
    };
  }

  saveFxOverride(): void {
    const eur = Number(this.fxOverrideForm.eur_per_ron);
    const usd = Number(this.fxOverrideForm.usd_per_ron);
    const asOf = (this.fxOverrideForm.as_of || '').trim();
    if (!(eur > 0) || !(usd > 0)) {
      this.toast.error(this.t('adminUi.fx.errors.invalid'));
      return;
    }

    this.fxAdmin
      .setOverride({
        eur_per_ron: eur,
        usd_per_ron: usd,
        as_of: asOf ? asOf : null
      })
      .subscribe({
        next: () => {
          this.toast.success(this.t('adminUi.fx.success.overrideSet'));
          this.loadFxStatus();
        },
        error: () => this.toast.error(this.t('adminUi.fx.errors.overrideSet'))
      });
  }

  clearFxOverride(): void {
    const status = this.fxStatus();
    if (!status?.override) return;
    if (!confirm(this.t('adminUi.fx.confirmClear'))) return;
    this.fxAdmin.clearOverride().subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.fx.success.overrideCleared'));
        this.loadFxStatus();
      },
      error: () => this.toast.error(this.t('adminUi.fx.errors.overrideCleared'))
    });
  }

  startNewProduct(): void {
    this.editingId = null;
    this.productDetail = null;
    this.productImages.set([]);
    this.form = {
      name: '',
      slug: '',
      category_id: this.categories[0]?.id || '',
      price: 0,
      stock: 0,
      status: 'draft',
      sku: '',
      image: '',
      description: '',
      publish_at: '',
      is_bestseller: false,
      is_highlight: false
    };
  }

  loadProduct(slug: string): void {
    this.admin.getProduct(slug).subscribe({
      next: (prod) => {
        this.productDetail = prod;
        this.editingId = prod.slug;
        this.form = {
          name: prod.name,
          slug: prod.slug,
          category_id: prod.category_id || '',
          price: prod.price,
          stock: prod.stock_quantity,
          status: prod.status,
          sku: (prod as any).sku || '',
          image: '',
          description: prod.long_description || '',
          publish_at: prod.publish_at ? this.toLocalDateTime(prod.publish_at) : '',
          is_bestseller: (prod.tags || []).includes('bestseller'),
          is_highlight: (prod.tags || []).includes('highlight')
        };
        this.productImages.set((prod as any).images || []);
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.load'))
    });
  }

  saveProduct(): void {
    const payload: Partial<AdminProductDetail> = {
      name: this.form.name,
      slug: this.form.slug,
      category_id: this.form.category_id,
      base_price: this.form.price,
      stock_quantity: this.form.stock,
      status: this.form.status as any,
      short_description: this.form.description,
      long_description: this.form.description,
      sku: this.form.sku,
      publish_at: this.form.publish_at ? new Date(this.form.publish_at).toISOString() : null,
      tags: this.buildTags()
    } as any;
    const op = this.editingId
      ? this.admin.updateProduct(this.editingId, payload)
      : this.admin.createProduct(payload);
    op.subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.products.success.save'));
        this.loadAll();
        this.startNewProduct();
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.save'))
    });
  }

  deleteSelected(): void {
    if (!this.selectedIds.size) return;
    const ids = Array.from(this.selectedIds);
    const target = this.products.find((p) => p.id === ids[0]);
    if (!target) return;
    this.admin.deleteProduct(target.slug).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.products.success.delete'));
        this.products = this.products.filter((p) => !this.selectedIds.has(p.id));
        this.selectedIds.clear();
        this.computeAllSelected();
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.delete'))
    });
  }

  addCategory(): void {
    if (!this.categoryName || !this.categorySlug) {
      this.toast.error(this.t('adminUi.products.errors.required'));
      return;
    }
    this.admin.createCategory({ name: this.categoryName, slug: this.categorySlug }).subscribe({
      next: (cat) => {
        this.categories = [cat, ...this.categories];
        this.categoryName = '';
        this.categorySlug = '';
        this.toast.success(this.t('adminUi.categories.success.add'));
      },
      error: () => this.toast.error(this.t('adminUi.categories.errors.add'))
    });
  }

  deleteCategory(slug: string): void {
    this.admin.deleteCategory(slug).subscribe({
      next: () => {
        this.categories = this.categories.filter((c) => c.slug !== slug);
        this.toast.success(this.t('adminUi.categories.success.delete'));
      },
      error: () => this.toast.error(this.t('adminUi.categories.errors.delete'))
    });
  }

  duplicateProduct(slug: string): void {
    this.admin.duplicateProduct(slug).subscribe({
      next: (prod) => {
        this.toast.success(this.t('adminUi.products.success.duplicate'));
        this.loadAll();
        this.loadProduct(prod.slug);
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.duplicate'))
    });
  }

  setStock(id: string, value: number): void {
    this.stockEdits[id] = Number(value);
  }

  saveStock(product: AdminProduct): void {
    const newStock = this.stockEdits[product.id] ?? product.stock_quantity;
    this.admin.updateProduct(product.slug, { stock_quantity: newStock } as any).subscribe({
      next: () => {
        product.stock_quantity = newStock;
        this.toast.success(this.t('adminUi.products.success.save'));
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.save'))
    });
  }

  async saveBulkStock(): Promise<void> {
    if (this.bulkStock === null || !this.selectedIds.size) return;
    const tasks = Array.from(this.selectedIds).map((id) => {
      const prod = this.products.find((p) => p.id === id);
      if (!prod) return Promise.resolve();
      return firstValueFrom(this.admin.updateProduct(prod.slug, { stock_quantity: this.bulkStock! } as any)).then(() => {
        prod.stock_quantity = this.bulkStock!;
      });
    });
    try {
      await Promise.all(tasks);
      this.toast.success(this.t('adminUi.products.success.save'));
    } catch {
      this.toast.error(this.t('adminUi.products.errors.save'));
    }
  }

  buildTags(): string[] {
    const tags = new Set<string>();
    if (this.form.is_bestseller) tags.add('bestseller');
    if (this.form.is_highlight) tags.add('highlight');
    if (this.productDetail?.tags) this.productDetail.tags.forEach((t) => tags.add(t));
    return Array.from(tags);
  }

  upcomingProducts(): AdminProduct[] {
    const now = new Date();
    return this.products
      .filter((p) => p.publish_at && new Date(p.publish_at) > now)
      .sort((a, b) => new Date(a.publish_at || 0).getTime() - new Date(b.publish_at || 0).getTime());
  }

  toLocalDateTime(iso: string): string {
    const d = new Date(iso);
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  }

  onImageUpload(event: Event): void {
    if (!this.editingId) {
      this.toast.error(this.t('adminUi.products.errors.saveFirst'));
      return;
    }
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.admin.uploadProductImage(this.editingId, file).subscribe({
      next: (prod) => {
        this.productImages.set((prod as any).images || []);
        this.toast.success(this.t('adminUi.products.success.imageUpload'));
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.image'))
    });
  }

  deleteImage(id: string): void {
    if (!this.editingId) return;
    this.admin.deleteProductImage(this.editingId, id).subscribe({
      next: (prod) => {
        this.productImages.set((prod as any).images || []);
        this.toast.success(this.t('adminUi.products.success.imageDelete'));
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.deleteImage'))
    });
  }

  selectOrder(order: AdminOrder): void {
    this.activeOrder = { ...order };
  }

  filteredOrders(): AdminOrder[] {
    return this.orders.filter((o) => (this.orderFilter ? o.status === this.orderFilter : true));
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.allSelected = checked;
    if (checked) this.selectedIds = new Set(this.products.map((p) => p.id));
    else this.selectedIds.clear();
  }

  toggleSelect(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
    this.computeAllSelected();
  }

  computeAllSelected(): void {
    this.allSelected = this.selectedIds.size > 0 && this.selectedIds.size === this.products.length;
  }

  changeOrderStatus(status: string): void {
    if (!this.activeOrder) return;
    this.admin.updateOrderStatus(this.activeOrder.id, status).subscribe({
      next: (order) => {
        this.toast.success(this.t('adminUi.orders.success.status'));
        this.activeOrder = order;
        this.orders = this.orders.map((o) => (o.id === order.id ? order : o));
      },
      error: () => this.toast.error(this.t('adminUi.orders.errors.status'))
    });
  }

  forceLogout(): void {
    if (!this.selectedUserId) return;
    this.admin.revokeSessions(this.selectedUserId).subscribe({
      next: () => this.toast.success(this.t('adminUi.users.success.revoke')),
      error: () => this.toast.error(this.t('adminUi.users.errors.revoke'))
    });
  }

  selectUser(userId: string, role: string): void {
    this.selectedUserId = userId;
    this.selectedUserRole = role;
    this.loadUserAliases(userId);
  }

  onSelectedUserIdChange(userId: string): void {
    this.selectedUserId = userId;
    const user = this.users.find((u) => u.id === userId);
    this.selectedUserRole = user?.role ?? this.selectedUserRole;
    this.loadUserAliases(userId);
  }

  loadUserAliases(userId: string): void {
    if (!userId) return;
    this.userAliasesLoading = true;
    this.userAliasesError = null;
    this.userAliases = null;
    this.admin.userAliases(userId).subscribe({
      next: (resp) => {
        this.userAliases = resp;
      },
      error: () => {
        this.userAliasesError = 'Could not load alias history.';
      },
      complete: () => {
        this.userAliasesLoading = false;
      }
    });
  }

  userIdentity(user: AdminUser): string {
    return formatIdentity(user, user.email);
  }

  commentAuthorLabel(author: { id: string; name?: string | null; username?: string | null; name_tag?: number | null }): string {
    return formatIdentity(author, author.id);
  }

  updateRole(): void {
    if (!this.selectedUserId || !this.selectedUserRole) return;
    this.admin.updateUserRole(this.selectedUserId, this.selectedUserRole).subscribe({
      next: (updated) => {
        this.users = this.users.map((u) => (u.id === updated.id ? updated : u));
        this.toast.success(this.t('adminUi.users.success.role'));
      },
      error: () => this.toast.error(this.t('adminUi.users.errors.role'))
    });
  }

  moveCategory(cat: AdminCategory, delta: number): void {
    const sorted = [...this.categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const index = sorted.findIndex((c) => c.slug === cat.slug);
    const swapIndex = index + delta;
    if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return;
    const tmp = sorted[index].sort_order ?? 0;
    sorted[index].sort_order = sorted[swapIndex].sort_order ?? 0;
    sorted[swapIndex].sort_order = tmp;
    this.admin
      .reorderCategories(sorted.map((c) => ({ slug: c.slug, sort_order: c.sort_order ?? 0 })))
      .subscribe({
        next: (cats) => {
          this.categories = cats
            .map((c) => ({ ...c, sort_order: c.sort_order ?? 0 }))
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          this.toast.success(this.t('adminUi.categories.success.reorder'));
        },
        error: () => this.toast.error(this.t('adminUi.categories.errors.reorder'))
      });
  }

  onCategoryDragStart(slug: string): void {
    this.draggingSlug = slug;
  }

  onCategoryDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onCategoryDrop(targetSlug: string): void {
    if (!this.draggingSlug || this.draggingSlug === targetSlug) {
      this.draggingSlug = null;
      return;
    }
    const sorted = [...this.categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const fromIdx = sorted.findIndex((c) => c.slug === this.draggingSlug);
    const toIdx = sorted.findIndex((c) => c.slug === targetSlug);
    if (fromIdx === -1 || toIdx === -1) {
      this.draggingSlug = null;
      return;
    }
    const [moved] = sorted.splice(fromIdx, 1);
    sorted.splice(toIdx, 0, moved);
    sorted.forEach((c, idx) => (c.sort_order = idx));
    this.admin
      .reorderCategories(sorted.map((c) => ({ slug: c.slug, sort_order: c.sort_order ?? 0 })))
      .subscribe({
        next: (cats) => {
          this.categories = cats
            .map((c) => ({ ...c, sort_order: c.sort_order ?? 0 }))
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          this.toast.success(this.t('adminUi.categories.success.reorder'));
        },
        error: () => this.toast.error(this.t('adminUi.categories.errors.reorder')),
        complete: () => (this.draggingSlug = null)
      });
  }

  createCoupon(): void {
    if (!this.newCoupon.code) {
      this.toast.error(this.t('adminUi.coupons.errors.required'));
      return;
    }
    this.admin.createCoupon(this.newCoupon).subscribe({
      next: (c) => {
        this.coupons = [c, ...this.coupons];
        this.toast.success(this.t('adminUi.coupons.success.create'));
      },
      error: () => this.toast.error(this.t('adminUi.coupons.errors.create'))
    });
  }

  toggleCoupon(coupon: AdminCoupon): void {
    this.admin.updateCoupon(coupon.id, { active: !coupon.active }).subscribe({
      next: (c) => {
        this.coupons = this.coupons.map((x) => (x.id === c.id ? c : x));
        this.toast.success(this.t('adminUi.coupons.success.update'));
      },
      error: () => this.toast.error(this.t('adminUi.coupons.errors.update'))
    });
  }

  selectContent(content: AdminContent): void {
    this.selectedContent = content;
    this.contentForm = { title: content.title, body_markdown: '', status: 'draft' };
    this.admin.getContent(content.key).subscribe({
      next: (block) => {
        this.rememberContentVersion(content.key, block);
        this.contentForm = {
          title: block.title,
          body_markdown: block.body_markdown,
          status: block.status
        };
      },
      error: () => this.toast.error(this.t('adminUi.content.errors.update'))
    });
  }

  saveContent(): void {
    if (!this.selectedContent) return;
    const key = this.selectedContent.key;
    const payload = this.withExpectedVersion(key, {
      title: this.contentForm.title,
      body_markdown: this.contentForm.body_markdown,
      status: this.contentForm.status as any
    });
    this.admin.updateContentBlock(key, payload).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        this.toast.success(this.t('adminUi.content.success.update'));
        this.reloadContentBlocks();
        this.selectedContent = null;
      },
      error: (err) => {
        if (this.handleContentConflict(err, key, () => this.selectContent(this.selectedContent!))) return;
        this.toast.error(this.t('adminUi.content.errors.update'));
      }
    });
  }

  cancelContent(): void {
    this.selectedContent = null;
  }

  blogPosts(): AdminContent[] {
    return this.contentBlocks.filter((c) => c.key.startsWith('blog.'));
  }

  extractBlogSlug(key: string): string {
    return key.startsWith('blog.') ? key.slice('blog.'.length) : key;
  }

  currentBlogSlug(): string {
    return this.selectedBlogKey ? this.extractBlogSlug(this.selectedBlogKey) : '';
  }

  startBlogCreate(): void {
    this.showBlogCreate = true;
    this.selectedBlogKey = null;
    this.blogImages = [];
    this.blogCreate = {
      slug: '',
      baseLang: 'en',
      status: 'draft',
      published_at: '',
      title: '',
      body_markdown: '',
      summary: '',
      tags: '',
      cover_image_url: '',
      reading_time_minutes: '',
      includeTranslation: false,
      translationTitle: '',
      translationBody: ''
    };
  }

  cancelBlogCreate(): void {
    this.showBlogCreate = false;
  }

  closeBlogEditor(): void {
    this.selectedBlogKey = null;
    this.blogImages = [];
    this.blogPreviewUrl = null;
    this.blogPreviewExpiresAt = null;
    this.blogVersions = [];
    this.blogVersionDetail = null;
    this.blogDiffParts = [];
    this.resetBlogForm();
  }

  async createBlogPost(): Promise<void> {
    const slug = this.normalizeBlogSlug(this.blogCreate.slug);
    if (!slug) {
      this.toast.error(this.t('adminUi.blog.errors.slugRequiredTitle'), this.t('adminUi.blog.errors.slugRequiredCopy'));
      return;
    }
    if (!this.blogCreate.title.trim() || !this.blogCreate.body_markdown.trim()) {
      this.toast.error(this.t('adminUi.blog.errors.titleBodyRequired'));
      return;
    }

    const key = `blog.${slug}`;
    const baseLang = this.blogCreate.baseLang;
    const translationLang: 'en' | 'ro' = baseLang === 'en' ? 'ro' : 'en';
    const meta: Record<string, any> = {};
    const summary = this.blogCreate.summary.trim();
    if (summary) {
      meta['summary'] = { [baseLang]: summary };
    }
    const tags = this.parseTags(this.blogCreate.tags);
    if (tags.length) {
      meta['tags'] = tags;
    }
    const cover = this.blogCreate.cover_image_url.trim();
    if (cover) {
      meta['cover_image_url'] = cover;
    }
    const rt = Number(String(this.blogCreate.reading_time_minutes || '').trim());
    if (Number.isFinite(rt) && rt > 0) {
      meta['reading_time_minutes'] = Math.trunc(rt);
    }
    const published_at = this.blogCreate.published_at ? new Date(this.blogCreate.published_at).toISOString() : undefined;

    try {
      const created = await firstValueFrom(
        this.admin.createContent(key, {
          title: this.blogCreate.title.trim(),
          body_markdown: this.blogCreate.body_markdown,
          status: this.blogCreate.status,
          lang: baseLang,
          published_at,
          meta: Object.keys(meta).length ? meta : undefined
        })
      );
      this.rememberContentVersion(key, created);

      if (this.blogCreate.includeTranslation) {
        const tTitle = this.blogCreate.translationTitle.trim();
        const tBody = this.blogCreate.translationBody.trim();
        if (tTitle || tBody) {
          await firstValueFrom(
            this.admin.updateContentBlock(
              key,
              this.withExpectedVersion(key, {
                title: tTitle || this.blogCreate.title.trim(),
                body_markdown: tBody || this.blogCreate.body_markdown,
                lang: translationLang
              })
            )
          );
        }
      }

      this.toast.success(this.t('adminUi.blog.success.created'));
      this.showBlogCreate = false;
      this.reloadContentBlocks();
      this.loadBlogEditor(key);
    } catch {
      this.toast.error(this.t('adminUi.blog.errors.create'));
    }
  }

  selectBlogPost(post: AdminContent): void {
    this.showBlogCreate = false;
    this.loadBlogEditor(post.key);
  }

  setBlogEditLang(lang: 'en' | 'ro'): void {
    if (!this.selectedBlogKey) return;
    this.blogEditLang = lang;
    const key = this.selectedBlogKey;
    const wantsBase = lang === this.blogBaseLang;
    this.admin.getContent(key, wantsBase ? undefined : lang).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        this.blogForm.title = block.title;
        this.blogForm.body_markdown = block.body_markdown;
        if (wantsBase) {
          this.blogForm.status = block.status;
        }
        this.blogForm.published_at = block.published_at ? this.toLocalDateTime(block.published_at) : '';
        this.blogMeta = block.meta || this.blogMeta || {};
        this.syncBlogMetaToForm(lang);
      },
      error: () => this.toast.error(this.t('adminUi.blog.errors.loadContent'))
    });
  }

  saveBlogPost(): void {
    if (!this.selectedBlogKey) return;
    if (!this.blogForm.title.trim() || !this.blogForm.body_markdown.trim()) {
      this.toast.error(this.t('adminUi.blog.errors.titleBodyRequired'));
      return;
    }

    const key = this.selectedBlogKey;
    const nextMeta = this.buildBlogMeta(this.blogEditLang);
    const metaChanged = JSON.stringify(nextMeta) !== JSON.stringify(this.blogMeta || {});
    const isBase = this.blogEditLang === this.blogBaseLang;
    const published_at = isBase
      ? this.blogForm.published_at
        ? new Date(this.blogForm.published_at).toISOString()
        : null
      : undefined;
    if (isBase) {
      const payload = this.withExpectedVersion(key, {
        title: this.blogForm.title.trim(),
        body_markdown: this.blogForm.body_markdown,
        status: this.blogForm.status as any,
        published_at,
        meta: nextMeta
      });
      this.admin.updateContentBlock(key, payload).subscribe({
        next: (block) => {
          this.rememberContentVersion(key, block);
          this.blogMeta = nextMeta;
          this.toast.success(this.t('adminUi.blog.success.saved'));
          this.reloadContentBlocks();
          this.loadBlogEditor(key);
        },
        error: (err) => {
          if (this.handleContentConflict(err, key, () => this.loadBlogEditor(key))) return;
          this.toast.error(this.t('adminUi.blog.errors.save'));
        }
      });
      return;
    }

    this.admin.updateContentBlock(
      key,
      this.withExpectedVersion(key, {
        title: this.blogForm.title.trim(),
        body_markdown: this.blogForm.body_markdown,
        lang: this.blogEditLang
      })
    ).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        const onDone = () => {
          this.toast.success(this.t('adminUi.blog.success.translationSaved'));
          this.reloadContentBlocks();
          this.setBlogEditLang(this.blogEditLang);
        };
        if (!metaChanged) {
          onDone();
          return;
        }
        this.admin.updateContentBlock(key, this.withExpectedVersion(key, { meta: nextMeta })).subscribe({
          next: (metaBlock) => {
            this.rememberContentVersion(key, metaBlock);
            this.blogMeta = nextMeta;
            onDone();
          },
          error: (err) => {
            if (this.handleContentConflict(err, key, () => this.setBlogEditLang(this.blogEditLang))) return;
            this.toast.error(this.t('adminUi.blog.errors.translationMetaSave'));
            onDone();
          }
        });
      },
      error: (err) => {
        if (this.handleContentConflict(err, key, () => this.setBlogEditLang(this.blogEditLang))) return;
        this.toast.error(this.t('adminUi.blog.errors.translationSave'));
      }
    });
  }

  generateBlogPreviewLink(): void {
    if (!this.selectedBlogKey) return;
    const slug = this.currentBlogSlug();
    this.blog.createPreviewToken(slug, { lang: this.blogEditLang }).subscribe({
      next: (resp) => {
        this.blogPreviewUrl = resp.url;
        this.blogPreviewExpiresAt = resp.expires_at;
        this.toast.success(this.t('adminUi.blog.preview.success.ready'));
        void this.copyToClipboard(resp.url).then((ok) => {
          if (ok) this.toast.info(this.t('adminUi.blog.preview.success.copied'));
        });
      },
      error: () => this.toast.error(this.t('adminUi.blog.preview.errors.generate'))
    });
  }

  copyBlogPreviewLink(): void {
    if (!this.blogPreviewUrl) return;
    void this.copyToClipboard(this.blogPreviewUrl).then((ok) => {
      if (ok) this.toast.info(this.t('adminUi.blog.preview.success.copied'));
      else this.toast.error(this.t('adminUi.blog.preview.errors.copy'));
    });
  }

  loadBlogVersions(): void {
    if (!this.selectedBlogKey) return;
    this.admin.listContentVersions(this.selectedBlogKey).subscribe({
      next: (items) => {
        this.blogVersions = items;
        this.blogVersionDetail = null;
        this.blogDiffParts = [];
      },
      error: () => this.toast.error(this.t('adminUi.blog.revisions.errors.load'))
    });
  }

  loadFlaggedComments(): void {
    this.flaggedCommentsLoading.set(true);
    this.flaggedCommentsError = null;
    this.blog.listFlaggedComments().subscribe({
      next: (resp) => {
        this.flaggedComments.set(resp.items || []);
      },
      error: () => {
        this.flaggedComments.set([]);
        this.flaggedCommentsError = this.t('adminUi.blog.moderation.errors.load');
      },
      complete: () => this.flaggedCommentsLoading.set(false)
    });
  }

  resolveFlags(comment: AdminBlogComment): void {
    this.blog.resolveCommentFlagsAdmin(comment.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.moderation.success.flagsResolved'));
        this.loadFlaggedComments();
      },
      error: () => this.toast.error(this.t('adminUi.blog.moderation.errors.resolveFlags'))
    });
  }

  toggleHide(comment: AdminBlogComment): void {
    if (comment.is_hidden) {
      this.blog.unhideCommentAdmin(comment.id).subscribe({
        next: () => {
          this.toast.success(this.t('adminUi.blog.moderation.success.commentUnhidden'));
          this.loadFlaggedComments();
        },
        error: () => this.toast.error(this.t('adminUi.blog.moderation.errors.unhide'))
      });
      return;
    }
    const reason = prompt(this.t('adminUi.blog.moderation.prompts.hideReason')) || '';
    this.blog.hideCommentAdmin(comment.id, { reason: reason.trim() || null }).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.moderation.success.commentHidden'));
        this.loadFlaggedComments();
      },
      error: () => this.toast.error(this.t('adminUi.blog.moderation.errors.hide'))
    });
  }

  adminDeleteComment(comment: AdminBlogComment): void {
    const ok = confirm(this.t('adminUi.blog.moderation.confirms.deleteComment'));
    if (!ok) return;
    this.blog.deleteComment(comment.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.moderation.success.commentDeleted'));
        this.loadFlaggedComments();
      },
      error: () => this.toast.error(this.t('adminUi.blog.moderation.errors.delete'))
    });
  }

  selectBlogVersion(version: number): void {
    if (!this.selectedBlogKey) return;
    this.admin.getContentVersion(this.selectedBlogKey, version).subscribe({
      next: (v) => {
        this.blogVersionDetail = v;
        this.blogDiffParts = diffLines(v.body_markdown || '', this.blogForm.body_markdown || '');
      },
      error: () => this.toast.error(this.t('adminUi.blog.revisions.errors.loadVersion'))
    });
  }

  rollbackBlogVersion(version: number): void {
    if (!this.selectedBlogKey) return;
    const ok = confirm(this.t('adminUi.blog.revisions.confirms.rollback', { version }));
    if (!ok) return;
    const key = this.selectedBlogKey;
    this.admin.rollbackContentVersion(key, version).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.revisions.success.rolledBack'));
        this.reloadContentBlocks();
        this.loadBlogEditor(key);
        this.loadBlogVersions();
      },
      error: () => this.toast.error(this.t('adminUi.blog.revisions.errors.rollback'))
    });
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
      } catch {
        return false;
      }
    }
  }

  renderMarkdown(markdown: string): string {
    return this.markdown.render(markdown);
  }

  applyBlogHeading(textarea: HTMLTextAreaElement, level: 1 | 2): void {
    const prefix = `${'#'.repeat(level)} `;
    this.prefixBlogLines(textarea, prefix);
  }

  applyBlogList(textarea: HTMLTextAreaElement): void {
    this.prefixBlogLines(textarea, '- ');
  }

  wrapBlogSelection(textarea: HTMLTextAreaElement, before: string, after: string, placeholder: string): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const hasSelection = end > start;
    const selected = hasSelection ? value.slice(start, end) : placeholder;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    const selStart = start + before.length;
    const selEnd = selStart + selected.length;
    this.updateBlogBody(textarea, next, selStart, selEnd);
  }

  insertBlogLink(textarea: HTMLTextAreaElement): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const hasSelection = end > start;
    const text = hasSelection ? value.slice(start, end) : 'link text';
    const url = 'https://';
    const snippet = `[${text}](${url})`;
    const next = value.slice(0, start) + snippet + value.slice(end);
    const urlStart = start + text.length + 3;
    this.updateBlogBody(textarea, next, urlStart, urlStart + url.length);
  }

  insertBlogCodeBlock(textarea: HTMLTextAreaElement): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const hasSelection = end > start;
    const selected = hasSelection ? value.slice(start, end) : 'code';
    const snippet = `\n\`\`\`\n${selected}\n\`\`\`\n`;
    const next = value.slice(0, start) + snippet + value.slice(end);
    const codeStart = start + 5;
    this.updateBlogBody(textarea, next, codeStart, codeStart + selected.length);
  }

  uploadAndInsertBlogImage(target: HTMLTextAreaElement | RichEditorComponent, event: Event): void {
    if (!this.selectedBlogKey) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.admin.uploadContentImage(this.selectedBlogKey, file).subscribe({
      next: (block) => {
        const images = (block.images || [])
          .map((img) => ({ id: img.id, url: img.url, alt_text: img.alt_text, sort_order: img.sort_order ?? 0 }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = images.map((img) => ({ id: img.id, url: img.url, alt_text: img.alt_text }));
        this.toast.success(this.t('adminUi.blog.images.success.uploaded'));
        const inserted = images[images.length - 1];
        if (inserted?.url) {
          const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\r\n]+/g, ' ').trim() || 'image';
          const snippet = `![${alt}](${inserted.url})`;
          if (target instanceof HTMLTextAreaElement) {
            this.insertAtCursor(target, snippet);
          } else {
            target.insertMarkdown(snippet);
          }
          this.toast.info(this.t('adminUi.blog.images.success.insertedMarkdown'));
        }
        input.value = '';
      },
      error: () => this.toast.error(this.t('adminUi.blog.images.errors.upload'))
    });
  }

  insertBlogImageMarkdown(url: string, altText?: string | null): void {
    const alt = (altText || 'image').replace(/[\r\n]+/g, ' ').trim();
    const snippet = `\n\n![${alt}](${url})\n`;
    this.blogForm.body_markdown = (this.blogForm.body_markdown || '').trimEnd() + snippet;
    this.toast.info(this.t('adminUi.blog.images.success.insertedMarkdown'));
  }

  private prefixBlogLines(textarea: HTMLTextAreaElement, prefix: string): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = end === start ? value.indexOf('\n', start) : value.indexOf('\n', end);
    const safeLineEnd = lineEnd === -1 ? value.length : lineEnd;
    const segment = value.slice(lineStart, safeLineEnd);
    const lines = segment.split('\n');
    const nextSegment = lines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (line.startsWith(prefix)) return line;
        return prefix + line;
      })
      .join('\n');
    const nextValue = value.slice(0, lineStart) + nextSegment + value.slice(safeLineEnd);
    const added = nextSegment.length - segment.length;
    this.updateBlogBody(textarea, nextValue, start + added, end + added);
  }

  private insertAtCursor(textarea: HTMLTextAreaElement, text: string): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const next = value.slice(0, start) + text + value.slice(end);
    const pos = start + text.length;
    this.updateBlogBody(textarea, next, pos, pos);
  }

  private updateBlogBody(textarea: HTMLTextAreaElement, nextValue: string, selectionStart: number, selectionEnd: number): void {
    this.blogForm.body_markdown = nextValue;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  private loadBlogEditor(key: string): void {
    this.selectedBlogKey = key;
    this.resetBlogForm();
    this.blogPreviewUrl = null;
    this.blogPreviewExpiresAt = null;
    this.blogVersions = [];
    this.blogVersionDetail = null;
    this.blogDiffParts = [];
    this.admin.getContent(key).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        this.blogBaseLang = (block.lang === 'ro' ? 'ro' : 'en') as 'en' | 'ro';
        this.blogEditLang = this.blogBaseLang;
        this.blogMeta = block.meta || {};
        this.blogForm = {
          title: block.title,
          body_markdown: block.body_markdown,
          status: block.status,
          published_at: block.published_at ? this.toLocalDateTime(block.published_at) : '',
          summary: '',
          tags: '',
          cover_image_url: '',
          reading_time_minutes: ''
        };
        this.syncBlogMetaToForm(this.blogEditLang);
        this.blogImages = (block.images || []).map((img) => ({ id: img.id, url: img.url, alt_text: img.alt_text }));
        this.loadBlogVersions();
      },
      error: () => this.toast.error(this.t('adminUi.blog.errors.loadPost'))
    });
  }

  private reloadContentBlocks(): void {
    this.admin.content().subscribe({ next: (c) => (this.contentBlocks = c) });
  }

  private resetBlogForm(): void {
    this.blogForm = {
      title: '',
      body_markdown: '',
      status: 'draft',
      published_at: '',
      summary: '',
      tags: '',
      cover_image_url: '',
      reading_time_minutes: ''
    };
    this.blogMeta = {};
  }

  private normalizeBlogSlug(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private parseTags(raw: string): string[] {
    const parts = (raw || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of parts) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
    return out;
  }

  private getBlogSummary(meta: Record<string, any>, lang: 'en' | 'ro'): string {
    const summary = meta?.['summary'];
    if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
      const value = summary[lang];
      return typeof value === 'string' ? value : '';
    }
    if (typeof summary === 'string') {
      return lang === this.blogBaseLang ? summary : '';
    }
    return '';
  }

  private syncBlogMetaToForm(lang: 'en' | 'ro'): void {
    const meta = this.blogMeta || {};
    this.blogForm.summary = this.getBlogSummary(meta, lang);
    const tags = meta['tags'];
    if (Array.isArray(tags)) {
      this.blogForm.tags = tags.join(', ');
    } else if (typeof tags === 'string') {
      this.blogForm.tags = tags;
    } else {
      this.blogForm.tags = '';
    }

    const cover = meta['cover_image_url'] || meta['cover_image'] || '';
    this.blogForm.cover_image_url = typeof cover === 'string' ? cover : '';
    const rt = meta['reading_time_minutes'] ?? meta['reading_time'] ?? '';
    this.blogForm.reading_time_minutes = rt ? String(rt) : '';
  }

  private buildBlogMeta(lang: 'en' | 'ro'): Record<string, any> {
    const meta: Record<string, any> = { ...(this.blogMeta || {}) };

    const tags = this.parseTags(this.blogForm.tags);
    if (tags.length) meta['tags'] = tags;
    else delete meta['tags'];

    const cover = this.blogForm.cover_image_url.trim();
    if (cover) meta['cover_image_url'] = cover;
    else delete meta['cover_image_url'];

    const rt = Number(String(this.blogForm.reading_time_minutes || '').trim());
    if (Number.isFinite(rt) && rt > 0) meta['reading_time_minutes'] = Math.trunc(rt);
    else delete meta['reading_time_minutes'];

    const summaryValue = this.blogForm.summary.trim();
    const existing = meta['summary'];
    let summary: Record<string, any> = {};
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      summary = { ...existing };
    } else if (typeof existing === 'string' && existing.trim()) {
      summary = { [this.blogBaseLang]: existing.trim() };
    }
    if (summaryValue) summary[lang] = summaryValue;
    else delete summary[lang];
    if (Object.keys(summary).length) meta['summary'] = summary;
    else delete meta['summary'];

    return meta;
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
          social_image_url: block.meta?.['social_image_url'] || ''
        };
        this.assetsMessage = null;
      },
      error: () => {
        delete this.contentVersions['site.assets'];
        this.assetsForm = { logo_url: '', favicon_url: '', social_image_url: '' };
      }
    });
  }

	  saveAssets(): void {
	    const payload = {
	      title: 'Site assets',
	      status: 'published',
	      meta: { ...this.assetsForm }
	    };
	    const onSuccess = (block?: { version?: number } | null) => {
        this.rememberContentVersion('site.assets', block);
	      this.assetsMessage = this.t('adminUi.site.assets.success.save');
	      this.assetsError = null;
	    };
	    this.admin.updateContentBlock('site.assets', this.withExpectedVersion('site.assets', payload)).subscribe({
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
	          }
	        })
        }
	    });
	  }

  loadSocial(): void {
    this.socialError = null;
    this.socialMessage = null;
    this.admin.getContent('site.social').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.social', block);
        const meta = (block.meta || {}) as Record<string, any>;
        const contact = (meta['contact'] || {}) as Record<string, any>;
        this.socialForm.phone = String(contact['phone'] || this.socialForm.phone || '').trim();
        this.socialForm.email = String(contact['email'] || this.socialForm.email || '').trim();
        this.socialForm.instagram_pages = this.parseSocialPages(meta['instagram_pages'], this.socialForm.instagram_pages);
        this.socialForm.facebook_pages = this.parseSocialPages(meta['facebook_pages'], this.socialForm.facebook_pages);
      },
      error: () => {
        delete this.contentVersions['site.social'];
        // Keep defaults.
      }
    });
  }

  addSocialLink(platform: 'instagram' | 'facebook'): void {
    const item = { label: '', url: '', thumbnail_url: '' };
    if (platform === 'instagram') this.socialForm.instagram_pages = [...this.socialForm.instagram_pages, item];
    else this.socialForm.facebook_pages = [...this.socialForm.facebook_pages, item];
  }

  removeSocialLink(platform: 'instagram' | 'facebook', index: number): void {
    if (platform === 'instagram') {
      this.socialForm.instagram_pages = this.socialForm.instagram_pages.filter((_, i) => i !== index);
      return;
    }
    this.socialForm.facebook_pages = this.socialForm.facebook_pages.filter((_, i) => i !== index);
  }

  socialThumbKey(platform: 'instagram' | 'facebook', index: number): string {
    return `${platform}-${index}`;
  }

	  fetchSocialThumbnail(platform: 'instagram' | 'facebook', index: number): void {
	    const key = this.socialThumbKey(platform, index);
	    const pages = platform === 'instagram' ? this.socialForm.instagram_pages : this.socialForm.facebook_pages;
	    const page = pages[index];
	    const url = String(page?.url || '').trim();
	    if (!url) {
	      this.socialThumbErrors[key] = this.t('adminUi.site.social.errors.urlRequired');
	      return;
	    }

    this.socialThumbErrors[key] = '';
    this.socialThumbLoading[key] = true;

	    this.admin.fetchSocialThumbnail(url).subscribe({
	      next: (res) => {
	        this.socialThumbLoading[key] = false;
	        const thumb = String(res?.thumbnail_url || '').trim();
	        if (!thumb) {
	          this.socialThumbErrors[key] = this.t('adminUi.site.social.errors.noThumbnail');
	          return;
	        }
	        page.thumbnail_url = thumb;
	        this.toast.success(
	          this.t('adminUi.site.social.success.thumbnailUpdated'),
	          (page.label || '').trim() || (page.url || '').trim() || this.t('adminUi.site.social.socialLink')
	        );
	      },
	      error: (err) => {
	        this.socialThumbLoading[key] = false;
	        const msg = err?.error?.detail
	          ? String(err.error.detail)
	          : this.t('adminUi.site.social.errors.fetchFailed');
	        this.socialThumbErrors[key] = msg;
	      }
	    });
	  }

	  saveSocial(): void {
	    this.socialMessage = null;
	    this.socialError = null;
	    const instagram_pages = this.sanitizeSocialPages(this.socialForm.instagram_pages);
	    const facebook_pages = this.sanitizeSocialPages(this.socialForm.facebook_pages);
    const payload = {
      title: 'Site social links',
      body_markdown: 'Social pages and contact details used across the storefront.',
      status: 'published',
      meta: {
        version: 1,
        contact: { phone: (this.socialForm.phone || '').trim(), email: (this.socialForm.email || '').trim() },
        instagram_pages,
        facebook_pages
      }
	    };
	    const onSuccess = (block?: { version?: number } | null) => {
        this.rememberContentVersion('site.social', block);
	      this.socialMessage = this.t('adminUi.site.social.success.save');
	      this.socialError = null;
	    };
	    this.admin.updateContentBlock('site.social', this.withExpectedVersion('site.social', payload)).subscribe({
	      next: (block) => onSuccess(block),
	      error: (err) => {
          if (this.handleContentConflict(err, 'site.social', () => this.loadSocial())) {
            this.socialError = this.t('adminUi.site.social.errors.save');
            this.socialMessage = null;
            return;
          }
	        this.admin.createContent('site.social', payload).subscribe({
	          next: (created) => onSuccess(created),
	          error: () => {
	            this.socialError = this.t('adminUi.site.social.errors.save');
	            this.socialMessage = null;
	          }
	        })
        }
	    });
	  }

  private parseSocialPages(
    raw: unknown,
    fallback: Array<{ label: string; url: string; thumbnail_url: string }>
  ): Array<{ label: string; url: string; thumbnail_url: string }> {
    if (!Array.isArray(raw)) return fallback;
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const label = String((item as any).label ?? '').trim();
        const url = String((item as any).url ?? '').trim();
        const thumb = String((item as any).thumbnail_url ?? '').trim();
        return { label, url, thumbnail_url: thumb };
      })
      .filter((x): x is { label: string; url: string; thumbnail_url: string } => !!x);
  }

  private sanitizeSocialPages(
    pages: Array<{ label: string; url: string; thumbnail_url: string }>
  ): Array<{ label: string; url: string; thumbnail_url?: string | null }> {
    const out: Array<{ label: string; url: string; thumbnail_url?: string | null }> = [];
    for (const page of pages) {
      const label = String(page.label || '').trim();
      const url = String(page.url || '').trim();
      const thumb = String(page.thumbnail_url || '').trim();
      if (!label || !url) continue;
      out.push({ label, url, thumbnail_url: thumb || null });
    }
    return out;
  }

  selectSeoLang(lang: 'en' | 'ro'): void {
    this.seoLang = lang;
    this.loadSeo();
  }

  loadSeo(): void {
    this.seoMessage = null;
    this.seoError = null;
    this.admin.getContent(`seo.${this.seoPage}`, this.seoLang).subscribe({
      next: (block) => {
        this.rememberContentVersion(`seo.${this.seoPage}`, block);
        this.seoForm = {
          title: block.title || '',
          description: block.meta?.['description'] || ''
        };
        this.seoMessage = null;
      },
      error: () => {
        delete this.contentVersions[`seo.${this.seoPage}`];
        this.seoForm = { title: '', description: '' };
      }
    });
  }

	  saveSeo(): void {
    const payload = {
      title: this.seoForm.title,
      status: 'published',
      lang: this.seoLang,
      meta: { description: this.seoForm.description }
    };
	    const key = `seo.${this.seoPage}`;
	    const onSuccess = () => {
	      this.seoMessage = this.t('adminUi.site.seo.success.save');
	      this.seoError = null;
	    };
	    this.admin.updateContentBlock(key, this.withExpectedVersion(key, payload)).subscribe({
	      next: (block) => {
          this.rememberContentVersion(key, block);
          onSuccess();
        },
	      error: (err) => {
          if (this.handleContentConflict(err, key, () => this.loadSeo())) {
            this.seoError = this.t('adminUi.site.seo.errors.save');
            this.seoMessage = null;
            return;
          }
	        this.admin.createContent(key, payload).subscribe({
	          next: (created) => {
              this.rememberContentVersion(key, created);
              onSuccess();
            },
	          error: () => {
	            this.seoError = this.t('adminUi.site.seo.errors.save');
	            this.seoMessage = null;
	          }
	        })
        }
	    });
	  }

  selectInfoLang(lang: 'en' | 'ro'): void {
    this.infoLang = lang;
    this.loadInfo();
  }

  loadInfo(): void {
    const loadKey = (key: string, target: 'about' | 'faq' | 'shipping' | 'contact') => {
      this.admin.getContent(key, this.infoLang).subscribe({
        next: (block) => {
          this.rememberContentVersion(key, block);
          this.infoForm[target] = block.body_markdown || '';
        },
        error: () => {
          delete this.contentVersions[key];
          this.infoForm[target] = '';
        }
      });
    };
    loadKey('page.about', 'about');
    loadKey('page.faq', 'faq');
    loadKey('page.shipping', 'shipping');
    loadKey('page.contact', 'contact');
  }

	  saveInfo(key: 'page.about' | 'page.faq' | 'page.shipping' | 'page.contact', body: string): void {
    this.infoMessage = null;
    this.infoError = null;
    const payload = {
      title: key,
      body_markdown: body,
      status: 'published',
      lang: this.infoLang
	    };
	    const onSuccess = (block?: { version?: number } | null) => {
        this.rememberContentVersion(key, block);
	      this.infoMessage = this.t('adminUi.site.pages.success.save');
	      this.infoError = null;
	    };
	    this.admin.updateContentBlock(key, this.withExpectedVersion(key, payload)).subscribe({
	      next: (block) => onSuccess(block),
	      error: (err) => {
          if (this.handleContentConflict(err, key, () => this.loadInfo())) {
            this.infoError = this.t('adminUi.site.pages.errors.save');
            this.infoMessage = null;
            return;
          }
	        this.admin.createContent(key, payload).subscribe({
	          next: (created) => onSuccess(created),
	          error: () => {
	            this.infoError = this.t('adminUi.site.pages.errors.save');
	            this.infoMessage = null;
	          }
	        })
        }
	    });
	  }

  // Homepage hero
  selectHeroLang(lang: string): void {
    if (this.heroLang === lang) return;
    this.heroLang = lang;
    this.loadHero(lang);
  }

  loadHero(lang: string): void {
    this.heroMessage.set(null);
    this.heroError.set(null);
    this.admin.getContent('home.hero', lang).subscribe({
      next: (block) => {
        this.rememberContentVersion('home.hero', block);
        const meta = block.meta || {};
        this.heroForm = {
          title: block.title,
          subtitle: block.body_markdown,
          cta_label: meta['cta_label'] || '',
          cta_url: meta['cta_url'] || '',
          image: meta['image'] || ''
        };
      },
      error: (err) => {
        if (err?.status === 404) {
          delete this.contentVersions['home.hero'];
          this.heroForm = { title: '', subtitle: '', cta_label: '', cta_url: '', image: '' };
          return;
        }
        this.heroError.set(this.t('adminUi.home.hero.errors.load'));
      }
    });
  }

  saveHero(): void {
    const payload = {
      title: this.heroForm.title || 'Homepage hero',
      body_markdown: this.heroForm.subtitle || this.heroForm.title || 'Hero copy',
      status: 'published',
      meta: {
        cta_label: this.heroForm.cta_label,
        cta_url: this.heroForm.cta_url,
        image: this.heroForm.image
      },
      lang: this.heroLang
    };
    const handleError = () => {
      this.heroError.set(this.t('adminUi.home.hero.errors.save'));
      this.heroMessage.set(null);
    };
    this.admin.updateContentBlock('home.hero', this.withExpectedVersion('home.hero', payload)).subscribe({
      next: (block) => {
        this.rememberContentVersion('home.hero', block);
        this.heroMessage.set(this.t('adminUi.home.hero.success.saved'));
        this.heroError.set(null);
      },
      error: (err) => {
        if (this.handleContentConflict(err, 'home.hero', () => this.loadHero(this.heroLang))) return;
        if (err?.status === 404) {
          this.admin.createContent('home.hero', payload).subscribe({
            next: (created) => {
              this.rememberContentVersion('home.hero', created);
              this.heroMessage.set(this.t('adminUi.home.hero.success.created'));
              this.heroError.set(null);
            },
            error: handleError
          });
          return;
        }
        handleError();
      }
    });
  }

  // Sections ordering
  loadSections(): void {
    this.admin.getContent('home.sections').subscribe({
      next: (block) => {
        this.rememberContentVersion('home.sections', block);
        const rawSections = block.meta?.['sections'];
        if (Array.isArray(rawSections) && rawSections.length) {
          const order: string[] = [];
          const enabled: Record<string, boolean> = {};
          for (const raw of rawSections) {
            if (!raw || typeof raw !== 'object') continue;
            const id = (raw as { id?: unknown }).id;
            if (typeof id !== 'string' || !id.trim()) continue;
            const normalized = this.normalizeHomeSectionId(id);
            if (!normalized || order.includes(normalized)) continue;
            order.push(normalized);
            const isEnabled = (raw as { enabled?: unknown }).enabled;
            enabled[normalized] = isEnabled === false ? false : true;
          }
          if (order.length) {
            this.sectionOrder = this.ensureAllDefaultHomeSections(order);
            this.sectionEnabled = this.ensureAllDefaultHomeSectionsEnabled(this.sectionOrder, enabled);
            return;
          }
        }

        const legacyOrder = block.meta?.['order'];
        if (Array.isArray(legacyOrder) && legacyOrder.length) {
          const normalized: string[] = [];
          const enabled: Record<string, boolean> = {};
          for (const id of legacyOrder) {
            const mapped = this.normalizeHomeSectionId(id);
            if (!mapped || normalized.includes(mapped)) continue;
            normalized.push(mapped);
            enabled[mapped] = true;
          }
          if (normalized.length) {
            this.sectionOrder = this.ensureAllDefaultHomeSections(normalized);
            this.sectionEnabled = this.ensureAllDefaultHomeSectionsEnabled(this.sectionOrder, enabled);
            return;
          }
        }

        this.applyDefaultHomeSections();
      },
      error: () => {
        delete this.contentVersions['home.sections'];
        this.applyDefaultHomeSections();
      }
    });
  }

  private normalizeHomeSectionId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw) return null;
    const key = raw
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (this.defaultHomeSectionIds().includes(key)) return key;
    if (key === 'collections') return 'featured_collections';
    if (key === 'featured') return 'featured_products';
    if (key === 'bestsellers') return 'featured_products';
    if (key === 'new') return 'new_arrivals';
    if (key === 'recent') return 'recently_viewed';
    if (key === 'recentlyviewed') return 'recently_viewed';
    return null;
  }

  private defaultHomeSectionIds(): string[] {
    return ['hero', 'featured_products', 'new_arrivals', 'featured_collections', 'story', 'recently_viewed', 'why'];
  }

  private ensureAllDefaultHomeSections(order: string[]): string[] {
    const out = [...order];
    for (const id of this.defaultHomeSectionIds()) {
      if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  private ensureAllDefaultHomeSectionsEnabled(order: string[], enabled: Record<string, boolean>): Record<string, boolean> {
    const out: Record<string, boolean> = { ...enabled };
    for (const id of order) {
      if (!(id in out)) out[id] = true;
    }
    return out;
  }

  private applyDefaultHomeSections(): void {
    const defaults = this.defaultHomeSectionIds();
    this.sectionOrder = defaults;
    const enabled: Record<string, boolean> = {};
    for (const id of defaults) enabled[id] = true;
    this.sectionEnabled = enabled;
  }

  sectionLabel(section: string): string {
    return section
      .split('_')
      .filter((s) => s.length)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(' ');
  }

  isSectionEnabled(section: string): boolean {
    return this.sectionEnabled[section] !== false;
  }

  toggleSectionEnabled(section: string, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.sectionEnabled[section] = Boolean(target?.checked);
  }

  onSectionDragStart(section: string): void {
    this.draggingSection = section;
  }

  onSectionDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onSectionDrop(section: string): void {
    if (!this.draggingSection || this.draggingSection === section) return;
    const current = [...this.sectionOrder];
    const from = current.indexOf(this.draggingSection);
    const to = current.indexOf(section);
    if (from === -1 || to === -1) {
      this.draggingSection = null;
      return;
    }
    current.splice(from, 1);
    current.splice(to, 0, this.draggingSection);
    this.sectionOrder = current;
    this.draggingSection = null;
  }

  saveSections(): void {
    const sections = this.sectionOrder.map((id) => ({ id, enabled: this.isSectionEnabled(id) }));
    const payload = {
      title: 'Home sections',
      body_markdown: 'Home layout order',
      meta: { version: 1, sections },
      status: 'published'
    };
    const ok = this.t('adminUi.home.sections.success.save');
    const errMsg = this.t('adminUi.home.sections.errors.save');
    this.admin.updateContentBlock('home.sections', this.withExpectedVersion('home.sections', payload)).subscribe({
      next: (block) => {
        this.rememberContentVersion('home.sections', block);
        this.sectionsMessage = ok;
      },
      error: (err) => {
        if (this.handleContentConflict(err, 'home.sections', () => this.loadSections())) {
          this.sectionsMessage = errMsg;
          return;
        }
        if (err?.status === 404) {
          this.admin.createContent('home.sections', payload).subscribe({
            next: (created) => {
              this.rememberContentVersion('home.sections', created);
              this.sectionsMessage = ok;
            },
            error: () => (this.sectionsMessage = errMsg)
          });
        } else {
          this.sectionsMessage = errMsg;
        }
      }
    });
  }

  // Featured collections
  loadCollections(): void {
    this.admin.listFeaturedCollections().subscribe({
      next: (cols) => (this.featuredCollections = cols),
      error: () => (this.featuredCollections = [])
    });
  }

  resetCollectionForm(): void {
    this.editingCollection = null;
    this.collectionForm = { slug: '', name: '', description: '', product_ids: [] };
    this.collectionMessage = '';
  }

  editCollection(col: FeaturedCollection): void {
    this.editingCollection = col.slug;
    this.collectionForm = {
      slug: col.slug,
      name: col.name,
      description: col.description || '',
      product_ids: col.product_ids || []
    };
  }

  saveCollection(): void {
    if (!this.collectionForm.slug || !this.collectionForm.name) {
      this.toast.error(this.t('adminUi.home.collections.errors.required'));
      return;
    }
    const payload = {
      slug: this.collectionForm.slug,
      name: this.collectionForm.name,
      description: this.collectionForm.description,
      product_ids: this.collectionForm.product_ids
    };
    const obs = this.editingCollection
      ? this.admin.updateFeaturedCollection(this.editingCollection, payload)
      : this.admin.createFeaturedCollection(payload);
    obs.subscribe({
      next: (col) => {
        const existing = this.featuredCollections.find((c) => c.slug === col.slug);
        if (existing) {
          this.featuredCollections = this.featuredCollections.map((c) => (c.slug === col.slug ? col : c));
        } else {
          this.featuredCollections = [col, ...this.featuredCollections];
        }
        this.collectionMessage = this.t('adminUi.home.collections.success.saved');
        this.editingCollection = null;
      },
      error: () => this.toast.error(this.t('adminUi.home.collections.errors.save'))
    });
  }

  saveMaintenance(): void {
    this.admin.setMaintenance(this.maintenanceEnabledValue).subscribe({
      next: (res) => {
        this.maintenanceEnabled.set(res.enabled);
        this.maintenanceEnabledValue = res.enabled;
        this.toast.success(this.t('adminUi.maintenance.success.update'));
      },
      error: () => this.toast.error(this.t('adminUi.maintenance.errors.update'))
    });
  }
}
