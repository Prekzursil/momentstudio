import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ContainerComponent } from '../../layout/container.component';
import { CardComponent } from '../../shared/card.component';
import { ButtonComponent } from '../../shared/button.component';
import { InputComponent } from '../../shared/input.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { SkeletonComponent } from '../../shared/skeleton.component';
import {
  AdminService,
  AdminSummary,
  AdminProduct,
  AdminOrder,
  AdminUser,
  AdminContent,
  AdminCoupon,
  AdminAudit,
  LowStockItem,
  AdminCategory,
  AdminProductDetail,
  FeaturedCollection
} from '../../core/admin.service';
import { ToastService } from '../../core/toast.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ContainerComponent,
    BreadcrumbComponent,
    CardComponent,
    ButtonComponent,
    InputComponent,
    LocalizedCurrencyPipe,
    SkeletonComponent,
    TranslateModule
  ],
 template: `
    <app-container classes="py-8 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
        {{ error() }}
      </div>
      <div class="grid lg:grid-cols-[260px_1fr] gap-6">
        <aside class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
          <a class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.nav.dashboard' | translate }}</a>
          <a class="hover:text-slate-900 text-slate-700 dark:text-slate-200 dark:hover:text-white">{{ 'adminUi.nav.products' | translate }}</a>
          <a class="hover:text-slate-900 text-slate-700 dark:text-slate-200 dark:hover:text-white">{{ 'adminUi.nav.orders' | translate }}</a>
          <a class="hover:text-slate-900 text-slate-700 dark:text-slate-200 dark:hover:text-white">{{ 'adminUi.nav.users' | translate }}</a>
          <a class="hover:text-slate-900 text-slate-700 dark:text-slate-200 dark:hover:text-white">{{ 'adminUi.nav.content' | translate }}</a>
        </aside>

        <div class="grid gap-6" *ngIf="!loading(); else loadingTpl">
          <section class="grid gap-3">
            <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.dashboardTitle' | translate }}</h1>
            <div class="grid md:grid-cols-3 gap-4">
              <app-card [title]="'adminUi.cards.products' | translate" [subtitle]="summary()?.products + ' total'"></app-card>
              <app-card [title]="'adminUi.cards.orders' | translate" [subtitle]="summary()?.orders + ' total'"></app-card>
              <app-card [title]="'adminUi.cards.users' | translate" [subtitle]="summary()?.users + ' total'"></app-card>
            </div>
            <div class="grid md:grid-cols-3 gap-4">
              <app-card [title]="'adminUi.cards.lowStock' | translate" [subtitle]="summary()?.low_stock + ' items'"></app-card>
              <app-card [title]="'adminUi.cards.sales30' | translate" [subtitle]="(summary()?.sales_30d || 0) | localizedCurrency : 'USD'"></app-card>
              <app-card [title]="'adminUi.cards.orders30' | translate" [subtitle]="summary()?.orders_30d + ' orders'"></app-card>
              <app-card title="Open orders" [subtitle]="openOrdersCount() + ' pending'"></app-card>
              <app-card title="Recent orders" [subtitle]="recentOrdersCount() + ' in last view'"></app-card>
              <app-card title="Low stock items" [subtitle]="(lowStock?.length || 0) + ' tracked'"></app-card>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Global assets</h2>
              <app-button size="sm" variant="ghost" label="Reload" (action)="loadAssets()"></app-button>
            </div>
            <div class="grid md:grid-cols-3 gap-3 text-sm">
              <app-input label="Logo URL" [(value)]="assetsForm.logo_url"></app-input>
              <app-input label="Favicon URL" [(value)]="assetsForm.favicon_url"></app-input>
              <app-input label="Social preview image URL" [(value)]="assetsForm.social_image_url"></app-input>
            </div>
            <div class="flex items-center gap-2 text-sm">
              <app-button size="sm" label="Save assets" (action)="saveAssets()"></app-button>
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="assetsMessage">{{ assetsMessage }}</span>
              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="assetsError">{{ assetsError }}</span>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">SEO meta (per page & language)</h2>
              <div class="flex gap-2 text-sm">
                <label class="flex items-center gap-2">
                  Page
                  <select class="rounded border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="seoPage" (ngModelChange)="loadSeo()">
                    <option value="home">Home</option>
                    <option value="shop">Shop</option>
                    <option value="product">Product</option>
                    <option value="category">Category</option>
                    <option value="about">About</option>
                  </select>
                </label>
                <div class="flex items-center gap-2">
                  <button class="px-3 py-1 rounded border" [class.bg-slate-900]="seoLang === 'en'" [class.text-white]="seoLang === 'en'" (click)="selectSeoLang('en')">
                    EN
                  </button>
                  <button class="px-3 py-1 rounded border" [class.bg-slate-900]="seoLang === 'ro'" [class.text-white]="seoLang === 'ro'" (click)="selectSeoLang('ro')">
                    RO
                  </button>
                </div>
              </div>
            </div>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input label="Meta title" [(value)]="seoForm.title"></app-input>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                Meta description
                <textarea rows="2" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="seoForm.description"></textarea>
              </label>
            </div>
            <div class="flex items-center gap-2 text-sm">
              <app-button size="sm" label="Save SEO" (action)="saveSeo()"></app-button>
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="seoMessage">{{ seoMessage }}</span>
              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="seoError">{{ seoError }}</span>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Static pages (RO/EN)</h2>
              <div class="flex gap-2 text-sm">
                <button class="px-3 py-1 rounded border" [class.bg-slate-900]="infoLang === 'en'" [class.text-white]="infoLang === 'en'" (click)="selectInfoLang('en')">
                  EN
                </button>
                <button class="px-3 py-1 rounded border" [class.bg-slate-900]="infoLang === 'ro'" [class.text-white]="infoLang === 'ro'" (click)="selectInfoLang('ro')">
                  RO
                </button>
              </div>
            </div>
            <div class="grid gap-3 text-sm">
              <label class="grid gap-1 font-medium text-slate-700 dark:text-slate-200">
                About content
                <textarea rows="3" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="infoForm.about"></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" label="Save About" (action)="saveInfo('page.about', infoForm.about)"></app-button>
              </div>
              <label class="grid gap-1 font-medium text-slate-700 dark:text-slate-200">
                FAQ content
                <textarea rows="3" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="infoForm.faq"></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" label="Save FAQ" (action)="saveInfo('page.faq', infoForm.faq)"></app-button>
              </div>
              <label class="grid gap-1 font-medium text-slate-700 dark:text-slate-200">
                Shipping/Returns content
                <textarea rows="3" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="infoForm.shipping"></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" label="Save Shipping" (action)="saveInfo('page.shipping', infoForm.shipping)"></app-button>
                <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="infoMessage">{{ infoMessage }}</span>
                <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="infoError">{{ infoError }}</span>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Homepage hero (per language)</h2>
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
              <app-input label="Headline" [(value)]="heroForm.title"></app-input>
              <app-input label="Subtitle" [(value)]="heroForm.subtitle"></app-input>
              <app-input label="CTA label" [(value)]="heroForm.cta_label"></app-input>
              <app-input label="CTA URL" [(value)]="heroForm.cta_url"></app-input>
              <app-input label="Hero image URL" [(value)]="heroForm.image"></app-input>
            </div>
            <div class="flex gap-2">
              <app-button label="Save hero" (action)="saveHero()"></app-button>
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="heroMessage()">{{ heroMessage() }}</span>
              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="heroError()">{{ heroError() }}</span>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Homepage sections order</h2>
              <app-button size="sm" variant="ghost" label="Save order" (action)="saveSections()"></app-button>
            </div>
            <p class="text-sm text-slate-600 dark:text-slate-300">Drag to reorder hero / collections / bestsellers / new arrivals.</p>
            <div class="grid gap-2">
              <div
                *ngFor="let section of sectionOrder"
                class="flex items-center justify-between rounded-lg border border-dashed border-slate-300 p-3 text-sm bg-slate-50 dark:border-slate-700 dark:bg-slate-950/30"
                draggable="true"
                (dragstart)="onSectionDragStart(section)"
                (dragover)="onSectionDragOver($event)"
                (drop)="onSectionDrop(section)"
              >
                <span class="font-semibold text-slate-900 dark:text-slate-50 capitalize">{{ section.replace('_', ' ') }}</span>
                <span class="text-xs text-slate-500 dark:text-slate-400">drag</span>
              </div>
            </div>
            <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="sectionsMessage">{{ sectionsMessage }}</span>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Featured collections</h2>
              <app-button size="sm" variant="ghost" label="Reset" (action)="resetCollectionForm()"></app-button>
            </div>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input label="Slug" [(value)]="collectionForm.slug"></app-input>
              <app-input label="Name" [(value)]="collectionForm.name"></app-input>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                Description
                <textarea class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" rows="2" [(ngModel)]="collectionForm.description"></textarea>
              </label>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                Products (hold Ctrl/Cmd to multi-select)
                <select multiple class="rounded-lg border border-slate-200 bg-white px-3 py-2 min-h-[120px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="collectionForm.product_ids">
                  <option *ngFor="let p of products" [value]="p.id">{{ p.name }} ({{ p.slug }})</option>
                </select>
              </label>
            </div>
            <div class="flex gap-2">
              <app-button [label]="editingCollection ? 'Update collection' : 'Create collection'" (action)="saveCollection()"></app-button>
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="collectionMessage">{{ collectionMessage }}</span>
            </div>
            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div *ngFor="let col of featuredCollections" class="rounded-lg border border-slate-200 p-3 flex items-center justify-between dark:border-slate-700">
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ col.name }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ col.slug }} · {{ col.description }}</p>
                </div>
                <app-button size="sm" variant="ghost" label="Edit" (action)="editCollection(col)"></app-button>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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
                    <td>{{ product.price | localizedCurrency : product.currency || 'USD' }}</td>
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

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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
                  <p>{{ order.customer }} — {{ order.total_amount | localizedCurrency : order.currency || 'USD' }}</p>
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
                <p class="font-semibold text-slate-900 dark:text-slate-50 mt-2">{{ activeOrder.total_amount | localizedCurrency : activeOrder.currency || 'USD' }}</p>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.users.title' | translate }}</h2>
              <div class="flex gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.setRole' | translate"
                  [disabled]="!selectedUserId || !selectedUserRole"
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
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ user.name || user.email }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ user.email }}</p>
                </div>
                <div class="flex items-center gap-2 text-xs">
                  <input type="radio" name="userSelect" [value]="user.id" [(ngModel)]="selectedUserId" />
                  <select class="rounded border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [ngModel]="user.role" (ngModelChange)="selectUser(user.id, $event)">
                    <option value="customer">{{ 'adminUi.users.roles.customer' | translate }}</option>
                    <option value="admin">{{ 'adminUi.users.roles.admin' | translate }}</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Blog posts</h2>
              <div class="flex items-center gap-2">
                <app-button size="sm" variant="ghost" label="New post" (action)="startBlogCreate()"></app-button>
                <app-button
                  *ngIf="selectedBlogKey"
                  size="sm"
                  variant="ghost"
                  label="Close editor"
                  (action)="closeBlogEditor()"
                ></app-button>
              </div>
            </div>

            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div *ngIf="blogPosts().length === 0" class="text-sm text-slate-500 dark:text-slate-400">
                No posts yet. Create the first one to populate /blog.
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
                    View
                  </a>
                  <app-button size="sm" variant="ghost" label="Edit" (action)="selectBlogPost(post)"></app-button>
                </div>
              </div>
            </div>

            <div *ngIf="showBlogCreate" class="grid gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">Create blog post</p>
              <div class="grid md:grid-cols-2 gap-3 text-sm">
                <app-input label="Slug" [(value)]="blogCreate.slug" placeholder="e.g. my-first-post"></app-input>
                <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                  Base language
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.baseLang"
                  >
                    <option value="en">EN</option>
                    <option value="ro">RO</option>
                  </select>
                </label>
                <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                  Status
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.status"
                  >
                    <option value="draft">draft</option>
                    <option value="published">published</option>
                  </select>
                </label>
                <div class="md:col-span-2">
                  <app-input label="Title" [(value)]="blogCreate.title"></app-input>
                </div>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  Body (Markdown)
                  <textarea
                    rows="6"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.body_markdown"
                  ></textarea>
                </label>
              </div>

              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" [(ngModel)]="blogCreate.includeTranslation" /> Add optional translation
              </label>

              <div *ngIf="blogCreate.includeTranslation" class="grid md:grid-cols-2 gap-3 text-sm">
                <p class="md:col-span-2 text-xs text-slate-500 dark:text-slate-400">
                  Translation language: {{ blogCreate.baseLang === 'en' ? 'RO' : 'EN' }} (leave blank to skip).
                </p>
                <app-input label="Translated title" [(value)]="blogCreate.translationTitle"></app-input>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  Translated body (Markdown)
                  <textarea
                    rows="5"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.translationBody"
                  ></textarea>
                </label>
              </div>

              <div class="flex gap-2">
                <app-button label="Create post" (action)="createBlogPost()"></app-button>
                <app-button size="sm" variant="ghost" label="Cancel" (action)="cancelBlogCreate()"></app-button>
              </div>
            </div>

            <div *ngIf="selectedBlogKey" class="grid gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="grid gap-1">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    Editing: {{ selectedBlogKey }}
                  </p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    Base language: {{ blogBaseLang.toUpperCase() }} · Editing: {{ blogEditLang.toUpperCase() }}
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
                <app-input label="Title" [(value)]="blogForm.title"></app-input>
                <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                  Status (base only)
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.status"
                    [disabled]="blogEditLang !== blogBaseLang"
                  >
                    <option value="draft">draft</option>
                    <option value="published">published</option>
                  </select>
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  Body (Markdown)
                  <textarea
                    rows="10"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.body_markdown"
                  ></textarea>
                </label>
              </div>

              <div class="grid gap-2">
                <label class="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Upload image
                  <input type="file" accept="image/*" class="block mt-1 text-sm" (change)="uploadBlogImage($event)" />
                </label>
                <div *ngIf="blogImages.length" class="grid gap-2">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Images</p>
                  <div *ngFor="let img of blogImages" class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <a class="text-xs text-indigo-600 dark:text-indigo-300 hover:underline truncate" [href]="img.url" target="_blank" rel="noopener">
                      {{ img.url }}
                    </a>
                    <app-button
                      size="sm"
                      variant="ghost"
                      label="Insert markdown"
                      (action)="insertBlogImageMarkdown(img.url, img.alt_text)"
                    ></app-button>
                  </div>
                </div>
              </div>

              <div class="flex gap-2">
                <app-button label="Save" (action)="saveBlogPost()"></app-button>
                <a
                  class="inline-flex items-center justify-center rounded-full font-semibold transition px-3 py-2 text-sm bg-white text-slate-900 border border-slate-200 hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:bg-slate-800 dark:text-slate-50 dark:border-slate-700 dark:hover:border-slate-600"
                  [attr.href]="'/blog/' + currentBlogSlug()"
                  target="_blank"
                  rel="noopener"
                >
                  View
                </a>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                Tip: Posts render markdown as plain text for now. Add a renderer later if needed.
              </p>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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
                  <input type="checkbox" [(ngModel)]="showContentPreview" /> Live preview
                </label>
              </div>
              <div *ngIf="showContentPreview" class="rounded-lg border border-slate-200 p-3 bg-slate-50 text-sm text-slate-800 whitespace-pre-line dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200">
                {{ contentForm.body_markdown || 'Nothing to preview yet.' }}
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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
                    <ng-container *ngIf="coupon.amount_off">-{{ coupon.amount_off | localizedCurrency : coupon.currency || 'USD' }}</ng-container>
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

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.audit.title' | translate }}</h2>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadAudit()"></app-button>
            </div>
            <div class="grid md:grid-cols-2 gap-4 text-sm text-slate-700 dark:text-slate-200">
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
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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
    </app-container>
  `
})
export class AdminComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin' }
  ];

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
  sectionOrder: string[] = ['hero', 'collections', 'bestsellers', 'new_arrivals'];
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
    title: string;
    body_markdown: string;
    includeTranslation: boolean;
    translationTitle: string;
    translationBody: string;
  } = {
    slug: '',
    baseLang: 'en',
    status: 'draft',
    title: '',
    body_markdown: '',
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
    status: 'draft'
  };
  blogImages: { id: string; url: string; alt_text?: string | null }[] = [];

  assetsForm = { logo_url: '', favicon_url: '', social_image_url: '' };
  assetsMessage: string | null = null;
  assetsError: string | null = null;
  seoLang: 'en' | 'ro' = 'en';
  seoPage: 'home' | 'shop' | 'product' | 'category' | 'about' = 'home';
  seoForm = { title: '', description: '' };
  seoMessage: string | null = null;
  seoError: string | null = null;
  infoLang: 'en' | 'ro' = 'en';
  infoForm = { about: '', faq: '', shipping: '' };
  infoMessage: string | null = null;
  infoError: string | null = null;
  coupons: AdminCoupon[] = [];
  newCoupon: Partial<AdminCoupon> = { code: '', percentage_off: 0, active: true, currency: 'USD' };
  stockEdits: Record<string, number> = {};
  bulkStock: number | null = null;

  productAudit: AdminAudit['products'] = [];
  contentAudit: AdminAudit['content'] = [];
  lowStock: LowStockItem[] = [];

  constructor(private admin: AdminService, private toast: ToastService, private translate: TranslateService) {}

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.loading.set(true);
    this.error.set(null);
    this.admin.summary().subscribe({ next: (s) => this.summary.set(s) });
    this.admin.products().subscribe({ next: (p) => (this.products = p) });
    this.admin.orders().subscribe({
      next: (o) => {
        this.orders = o;
        this.activeOrder = o[0] || null;
      }
    });
    this.admin.users().subscribe({ next: (u) => (this.users = u) });
    this.admin.content().subscribe({ next: (c) => (this.contentBlocks = c) });
    this.admin.coupons().subscribe({ next: (c) => (this.coupons = c) });
    this.admin.lowStock().subscribe({ next: (items) => (this.lowStock = items) });
    this.admin.audit().subscribe({
      next: (logs) => {
        this.productAudit = logs.products;
        this.contentAudit = logs.content;
      }
    });
    this.admin.getCategories().subscribe({
      next: (cats) => {
        this.categories = cats
          .map((c) => ({ ...c, sort_order: c.sort_order ?? 0 }))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      }
    });
    this.loadHero(this.heroLang);
    this.loadSections();
    this.loadCollections();
    this.loadAssets();
    this.loadSeo();
    this.loadInfo();
    this.admin.getMaintenance().subscribe({
      next: (m) => {
        this.maintenanceEnabled.set(m.enabled);
        this.maintenanceEnabledValue = m.enabled;
      }
    });
    this.loading.set(false);
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
        this.toast.success('Product duplicated as draft');
        this.loadAll();
        this.loadProduct(prod.slug);
      },
      error: () => this.toast.error('Could not duplicate product')
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
    this.admin
      .updateContent(this.selectedContent.key, {
        title: this.contentForm.title,
        body_markdown: this.contentForm.body_markdown,
        status: this.contentForm.status as any
      })
      .subscribe({
        next: (updated) => {
          this.contentBlocks = this.contentBlocks.map((c) => (c.key === updated.key ? updated : c));
          this.toast.success(this.t('adminUi.content.success.update'));
          this.selectedContent = null;
        },
        error: () => this.toast.error(this.t('adminUi.content.errors.update'))
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
      title: '',
      body_markdown: '',
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
    this.resetBlogForm();
  }

  async createBlogPost(): Promise<void> {
    const slug = this.normalizeBlogSlug(this.blogCreate.slug);
    if (!slug) {
      this.toast.error('Slug is required', 'Use letters/numbers/dashes, e.g. "my-first-post".');
      return;
    }
    if (!this.blogCreate.title.trim() || !this.blogCreate.body_markdown.trim()) {
      this.toast.error('Title and body are required');
      return;
    }

    const key = `blog.${slug}`;
    const baseLang = this.blogCreate.baseLang;
    const translationLang: 'en' | 'ro' = baseLang === 'en' ? 'ro' : 'en';

    try {
      await firstValueFrom(
        this.admin.createContent(key, {
          title: this.blogCreate.title.trim(),
          body_markdown: this.blogCreate.body_markdown,
          status: this.blogCreate.status,
          lang: baseLang
        })
      );

      if (this.blogCreate.includeTranslation) {
        const tTitle = this.blogCreate.translationTitle.trim();
        const tBody = this.blogCreate.translationBody.trim();
        if (tTitle || tBody) {
          await firstValueFrom(
            this.admin.updateContentBlock(key, {
              title: tTitle || this.blogCreate.title.trim(),
              body_markdown: tBody || this.blogCreate.body_markdown,
              lang: translationLang
            })
          );
        }
      }

      this.toast.success('Blog post created');
      this.showBlogCreate = false;
      this.reloadContentBlocks();
      this.loadBlogEditor(key);
    } catch {
      this.toast.error('Could not create blog post');
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
        this.blogForm.title = block.title;
        this.blogForm.body_markdown = block.body_markdown;
        if (wantsBase) {
          this.blogForm.status = block.status;
        }
      },
      error: () => this.toast.error('Could not load blog post content')
    });
  }

  saveBlogPost(): void {
    if (!this.selectedBlogKey) return;
    if (!this.blogForm.title.trim() || !this.blogForm.body_markdown.trim()) {
      this.toast.error('Title and body are required');
      return;
    }

    const key = this.selectedBlogKey;
    const isBase = this.blogEditLang === this.blogBaseLang;
    if (isBase) {
      this.admin
        .updateContent(key, {
          title: this.blogForm.title.trim(),
          body_markdown: this.blogForm.body_markdown,
          status: this.blogForm.status as any
        })
        .subscribe({
          next: () => {
            this.toast.success('Saved');
            this.reloadContentBlocks();
            this.loadBlogEditor(key);
          },
          error: () => this.toast.error('Could not save blog post')
        });
      return;
    }

    this.admin
      .updateContentBlock(key, {
        title: this.blogForm.title.trim(),
        body_markdown: this.blogForm.body_markdown,
        lang: this.blogEditLang
      })
      .subscribe({
        next: () => {
          this.toast.success('Saved translation');
          this.reloadContentBlocks();
          this.setBlogEditLang(this.blogEditLang);
        },
        error: () => this.toast.error('Could not save translation')
      });
  }

  uploadBlogImage(event: Event): void {
    if (!this.selectedBlogKey) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.admin.uploadContentImage(this.selectedBlogKey, file).subscribe({
      next: (block) => {
        this.blogImages = (block.images || []).map((img) => ({ id: img.id, url: img.url, alt_text: img.alt_text }));
        this.toast.success('Image uploaded');
        input.value = '';
      },
      error: () => this.toast.error('Could not upload image')
    });
  }

  insertBlogImageMarkdown(url: string, altText?: string | null): void {
    const alt = (altText || 'image').replace(/[\r\n]+/g, ' ').trim();
    const snippet = `\n\n![${alt}](${url})\n`;
    this.blogForm.body_markdown = (this.blogForm.body_markdown || '').trimEnd() + snippet;
    this.toast.info('Inserted image markdown');
  }

  private loadBlogEditor(key: string): void {
    this.selectedBlogKey = key;
    this.resetBlogForm();
    this.admin.getContent(key).subscribe({
      next: (block) => {
        this.blogBaseLang = (block.lang === 'ro' ? 'ro' : 'en') as 'en' | 'ro';
        this.blogEditLang = this.blogBaseLang;
        this.blogForm = {
          title: block.title,
          body_markdown: block.body_markdown,
          status: block.status
        };
        this.blogImages = (block.images || []).map((img) => ({ id: img.id, url: img.url, alt_text: img.alt_text }));
      },
      error: () => this.toast.error('Could not load blog post')
    });
  }

  private reloadContentBlocks(): void {
    this.admin.content().subscribe({ next: (c) => (this.contentBlocks = c) });
  }

  private resetBlogForm(): void {
    this.blogForm = { title: '', body_markdown: '', status: 'draft' };
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

  loadAssets(): void {
    this.assetsError = null;
    this.assetsMessage = null;
    this.admin.getContent('site.assets').subscribe({
      next: (block) => {
        this.assetsForm = {
          logo_url: block.meta?.['logo_url'] || '',
          favicon_url: block.meta?.['favicon_url'] || '',
          social_image_url: block.meta?.['social_image_url'] || ''
        };
        this.assetsMessage = null;
      },
      error: () => {
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
    const onSuccess = () => {
      this.assetsMessage = 'Assets saved';
      this.assetsError = null;
    };
    this.admin.updateContentBlock('site.assets', payload).subscribe({
      next: onSuccess,
      error: () =>
        this.admin.createContent('site.assets', payload).subscribe({
          next: onSuccess,
          error: () => {
            this.assetsError = 'Could not save assets';
            this.assetsMessage = null;
          }
        })
    });
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
        this.seoForm = {
          title: block.title || '',
          description: block.meta?.['description'] || ''
        };
        this.seoMessage = null;
      },
      error: () => {
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
      this.seoMessage = 'SEO saved';
      this.seoError = null;
    };
    this.admin.updateContentBlock(key, payload).subscribe({
      next: onSuccess,
      error: () =>
        this.admin.createContent(key, payload).subscribe({
          next: onSuccess,
          error: () => {
            this.seoError = 'Could not save SEO';
            this.seoMessage = null;
          }
        })
    });
  }

  selectInfoLang(lang: 'en' | 'ro'): void {
    this.infoLang = lang;
    this.loadInfo();
  }

  loadInfo(): void {
    const loadKey = (key: string, target: 'about' | 'faq' | 'shipping') => {
      this.admin.getContent(key, this.infoLang).subscribe({
        next: (block) => {
          this.infoForm[target] = block.body_markdown || '';
        },
        error: () => {
          this.infoForm[target] = '';
        }
      });
    };
    loadKey('page.about', 'about');
    loadKey('page.faq', 'faq');
    loadKey('page.shipping', 'shipping');
  }

  saveInfo(key: 'page.about' | 'page.faq' | 'page.shipping', body: string): void {
    this.infoMessage = null;
    this.infoError = null;
    const payload = {
      title: key,
      body_markdown: body,
      status: 'published',
      lang: this.infoLang
    };
    const onSuccess = () => {
      this.infoMessage = 'Content saved';
      this.infoError = null;
    };
    this.admin.updateContentBlock(key, payload).subscribe({
      next: onSuccess,
      error: () =>
        this.admin.createContent(key, payload).subscribe({
          next: onSuccess,
          error: () => {
            this.infoError = 'Could not save content';
            this.infoMessage = null;
          }
        })
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
          this.heroForm = { title: '', subtitle: '', cta_label: '', cta_url: '', image: '' };
          return;
        }
        this.heroError.set('Could not load hero content');
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
      this.heroError.set('Could not save hero content');
      this.heroMessage.set(null);
    };
    this.admin.updateContent('home.hero', payload).subscribe({
      next: () => {
        this.heroMessage.set('Hero saved');
        this.heroError.set(null);
      },
      error: (err) => {
        if (err?.status === 404) {
          this.admin.createContent('home.hero', payload).subscribe({
            next: () => {
              this.heroMessage.set('Hero created');
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
        const order = block.meta?.['order'];
        if (Array.isArray(order) && order.length) {
          this.sectionOrder = order;
        }
      },
      error: () => {
        this.sectionOrder = ['hero', 'collections', 'bestsellers', 'new_arrivals'];
      }
    });
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
    const payload = {
      title: 'Home sections',
      body_markdown: 'Home layout order',
      meta: { order: this.sectionOrder },
      status: 'published'
    };
    this.admin.updateContent('home.sections', payload).subscribe({
      next: () => (this.sectionsMessage = 'Sections order saved'),
      error: (err) => {
        if (err?.status === 404) {
          this.admin.createContent('home.sections', payload).subscribe({
            next: () => (this.sectionsMessage = 'Sections order saved'),
            error: () => (this.sectionsMessage = 'Could not save sections order')
          });
        } else {
          this.sectionsMessage = 'Could not save sections order';
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
      this.toast.error('Slug and name are required');
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
        this.collectionMessage = 'Saved';
        this.editingCollection = null;
      },
      error: () => this.toast.error('Could not save collection')
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
