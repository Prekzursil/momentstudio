import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { ButtonComponent } from '../../shared/button.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { AccountComponent } from './account.component';

@Component({
  selector: 'app-account-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, ButtonComponent, SkeletonComponent],
  template: `
    <section class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <ng-container *ngIf="account.loading(); else profileBody">
        <div class="grid gap-3">
          <app-skeleton height="18px" width="200px"></app-skeleton>
          <app-skeleton height="120px"></app-skeleton>
          <app-skeleton height="120px"></app-skeleton>
        </div>
      </ng-container>

      <ng-template #profileBody>
      <div class="flex items-center justify-between">
        <div class="grid gap-1">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'account.sections.profile' | translate }}</h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            Profile completeness: {{ account.profileCompleteness().completed }}/{{ account.profileCompleteness().total }} ({{
              account.profileCompleteness().percent
            }}%)
          </p>
        </div>
        <app-button
          size="sm"
          variant="ghost"
          label="Save"
          [disabled]="account.savingProfile"
          (action)="account.saveProfile()"
        ></app-button>
      </div>

      <div
        *ngIf="account.profileCompletionRequired()"
        class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm grid gap-2 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
      >
        <p class="font-semibold">{{ 'account.completeProfile.title' | translate }}</p>
        <p class="text-xs text-amber-900/90 dark:text-amber-100/90">{{ 'account.completeProfile.copy' | translate }}</p>
        <ul class="grid gap-1 text-xs text-amber-900/90 dark:text-amber-100/90">
          <li *ngFor="let field of account.missingProfileFields()">• {{ account.requiredFieldLabelKey(field) | translate }}</li>
        </ul>
      </div>

      <div class="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div class="h-2 rounded-full bg-indigo-600" [style.width.%]="account.profileCompleteness().percent"></div>
      </div>

      <div class="grid gap-4">
        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-4">
          <div class="grid gap-1">
            <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">Public identity</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400">How you appear in comments and other public activity.</p>
          </div>

          <div class="flex flex-col sm:flex-row sm:items-center gap-4">
            <img
              [src]="account.avatar || account.profile()?.avatar_url || account.placeholderAvatar"
              alt="avatar"
              class="h-16 w-16 rounded-full object-cover border border-slate-200 dark:border-slate-800"
            />
            <div class="flex flex-wrap items-center gap-3">
              <label class="text-sm text-indigo-600 font-medium cursor-pointer dark:text-indigo-300">
                Upload avatar
                <input type="file" class="hidden" accept="image/*" (change)="onAvatarFileChange($event)" />
              </label>
              <app-button
                *ngIf="account.googlePicture() && (account.profile()?.avatar_url || '') !== (account.googlePicture() || '')"
                size="sm"
                variant="ghost"
                label="Use Google photo"
                [disabled]="account.avatarBusy"
                (action)="account.useGoogleAvatar()"
              ></app-button>
              <app-button
                *ngIf="account.profile()?.avatar_url"
                size="sm"
                variant="ghost"
                label="Remove"
                [disabled]="account.avatarBusy"
                (action)="account.removeAvatar()"
              ></app-button>
              <span class="text-xs text-slate-500 dark:text-slate-400">JPG/PNG/WebP up to 5MB</span>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.displayName' | translate }}
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileName"
                autocomplete="name"
                [required]="account.profileCompletionRequired()"
                [(ngModel)]="account.profileName"
              />
              <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
                Public: {{ account.publicIdentityLabel() }}
              </span>
              <span
                *ngIf="account.displayNameCooldownSeconds() > 0"
                class="text-xs font-normal text-amber-800 dark:text-amber-200"
              >
                {{
                  'account.cooldowns.displayName'
                    | translate: { time: account.formatCooldown(account.displayNameCooldownSeconds()) }
                }}
              </span>
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.username' | translate }}
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileUsername"
                autocomplete="username"
                minlength="3"
                maxlength="30"
                pattern="^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$"
                [required]="account.profileCompletionRequired()"
                [(ngModel)]="account.profileUsername"
              />
              <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
                Use this to sign in and as a stable handle in public activity.
              </span>
              <span
                *ngIf="account.usernameCooldownSeconds() > 0"
                class="text-xs font-normal text-amber-800 dark:text-amber-200"
              >
                {{ 'account.cooldowns.username' | translate: { time: account.formatCooldown(account.usernameCooldownSeconds()) } }}
              </span>
            </label>

            <label
              *ngIf="account.usernameChanged()"
              class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 sm:col-span-2"
            >
              {{ 'auth.currentPassword' | translate }}
              <div class="relative">
                <input
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  name="profileUsernamePassword"
                  [type]="showUsernamePassword ? 'text' : 'password'"
                  autocomplete="current-password"
                  required
                  [(ngModel)]="account.profileUsernamePassword"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
                  (click)="showUsernamePassword = !showUsernamePassword"
                  [attr.aria-label]="(showUsernamePassword ? 'auth.hidePassword' : 'auth.showPassword') | translate"
                >
                  {{ (showUsernamePassword ? 'auth.hide' : 'auth.show') | translate }}
                </button>
              </div>
              <span class="text-xs font-normal text-slate-500 dark:text-slate-400">Required to change your username.</span>
            </label>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-3">
          <div class="grid gap-1">
            <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">Private account info</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400">Used for orders, support, and legal requirements.</p>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.firstName' | translate }}
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileFirstName"
                autocomplete="given-name"
                [required]="account.profileCompletionRequired()"
                [(ngModel)]="account.profileFirstName"
              />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.middleName' | translate }}
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileMiddleName"
                autocomplete="additional-name"
                [(ngModel)]="account.profileMiddleName"
              />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.lastName' | translate }}
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileLastName"
                autocomplete="family-name"
                [required]="account.profileCompletionRequired()"
                [(ngModel)]="account.profileLastName"
              />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.dateOfBirth' | translate }}
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileDateOfBirth"
                type="date"
                [required]="account.profileCompletionRequired()"
                [(ngModel)]="account.profileDateOfBirth"
              />
            </label>

            <div class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.phone' | translate }}
              <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
                <select
                  name="profilePhoneCountry"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="account.profilePhoneCountry"
                >
                  <option *ngFor="let c of account.phoneCountries" [ngValue]="c.code">
                    {{ c.flag }} {{ c.name }} ({{ c.dial }})
                  </option>
                </select>
                <input
                  name="profilePhoneNational"
                  type="tel"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  autocomplete="tel-national"
                  pattern="^[0-9]{6,14}$"
                  placeholder="723204204"
                  [required]="account.profileCompletionRequired()"
                  [(ngModel)]="account.profilePhoneNational"
                />
              </div>
              <div class="grid gap-1">
                <span class="text-xs font-normal text-slate-500 dark:text-slate-400">{{ 'auth.phoneHint' | translate }}</span>
                <span
                  *ngIf="account.phoneNationalPreview() as preview"
                  class="text-xs font-normal text-slate-500 dark:text-slate-400"
                >
                  {{ 'account.profile.phone.formattedPreview' | translate: { value: preview } }}
                </span>
                <ng-container *ngIf="account.phoneE164Preview() as e164; else phoneInvalid">
                  <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
                    {{ 'account.profile.phone.e164Preview' | translate: { value: e164 } }}
                  </span>
                </ng-container>
                <ng-template #phoneInvalid>
                  <span
                    *ngIf="account.profilePhoneNational.trim()"
                    class="text-xs font-normal text-rose-700 dark:text-rose-300"
                  >
                    {{ 'validation.phoneInvalid' | translate }}
                  </span>
                </ng-template>
              </div>
            </div>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              Preferred language
              <select
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                name="profileLanguage"
                [(ngModel)]="account.profileLanguage"
              >
                <option value="en">EN</option>
                <option value="ro">RO</option>
              </select>
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              Theme
              <select
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                name="profileTheme"
                [(ngModel)]="account.profileThemePreference"
              >
                <option value="system">{{ 'theme.system' | translate }}</option>
                <option value="light">{{ 'theme.light' | translate }}</option>
                <option value="dark">{{ 'theme.dark' | translate }}</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <p *ngIf="account.profileError" class="text-sm text-rose-700 dark:text-rose-300">{{ account.profileError }}</p>
      <p *ngIf="account.profileSaved" class="text-sm text-emerald-700 dark:text-emerald-300">Saved.</p>

      <div class="grid gap-3 sm:grid-cols-2" *ngIf="account.isAuthenticated()">
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">Username history</p>
          <div *ngIf="account.aliasesLoading()" class="mt-2">
            <app-skeleton height="44px"></app-skeleton>
          </div>
          <p
            *ngIf="!account.aliasesLoading() && account.aliases()?.usernames?.length === 0"
            class="mt-2 text-sm text-slate-600 dark:text-slate-300"
          >
            No history yet.
          </p>
          <ul *ngIf="!account.aliasesLoading() && account.aliases()?.usernames?.length" class="mt-2 grid gap-2 text-sm">
            <li *ngFor="let h of account.aliases()!.usernames" class="flex items-center justify-between gap-2">
              <span class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ h.username }}</span>
              <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ h.created_at | date: 'short' }}</span>
            </li>
          </ul>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">Display name history</p>
          <div *ngIf="account.aliasesLoading()" class="mt-2">
            <app-skeleton height="44px"></app-skeleton>
          </div>
          <p
            *ngIf="!account.aliasesLoading() && account.aliases()?.display_names?.length === 0"
            class="mt-2 text-sm text-slate-600 dark:text-slate-300"
          >
            No history yet.
          </p>
          <ul *ngIf="!account.aliasesLoading() && account.aliases()?.display_names?.length" class="mt-2 grid gap-2 text-sm">
            <li *ngFor="let h of account.aliases()!.display_names" class="flex items-center justify-between gap-2">
              <span class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ h.name }}#{{ h.name_tag }}</span>
              <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ h.created_at | date: 'short' }}</span>
            </li>
          </ul>
        </div>
      </div>
      <p *ngIf="account.aliasesError()" class="text-sm text-rose-700 dark:text-rose-300">{{ account.aliasesError() }}</p>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        Session timeout: 30m. Your theme is saved on this device; language is saved to your profile when signed in.
      </p>
      </ng-template>
    </section>

    <ng-container *ngIf="avatarCropOpen">
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div
          class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        >
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">Crop avatar</h3>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
              (click)="cancelAvatarCrop()"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div class="mt-4 flex justify-center">
            <div
              class="relative h-64 w-64 overflow-hidden rounded-full border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
            >
              <img
                *ngIf="avatarCropUrl"
                [src]="avatarCropUrl"
                alt="Avatar preview"
                class="absolute left-1/2 top-1/2 max-w-none select-none"
                [style.transform]="avatarCropTransform"
              />
            </div>
          </div>

          <label class="mt-4 grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            Zoom
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              class="w-full"
              [(ngModel)]="avatarCropZoom"
              [disabled]="account.avatarBusy"
            />
          </label>

          <p *ngIf="avatarCropError" class="mt-2 text-sm text-rose-700 dark:text-rose-300">{{ avatarCropError }}</p>

          <div class="mt-4 flex justify-end gap-2">
            <app-button size="sm" variant="ghost" label="Cancel" [disabled]="account.avatarBusy" (action)="cancelAvatarCrop()"></app-button>
            <app-button
              size="sm"
              label="Upload"
              [disabled]="account.avatarBusy || !avatarCropReady"
              (action)="confirmAvatarCrop()"
            ></app-button>
          </div>
        </div>
      </div>
    </ng-container>
  `
})
export class AccountProfileComponent implements OnDestroy {
  protected readonly account = inject(AccountComponent);
  showUsernamePassword = false;
  avatarCropOpen = false;
  avatarCropUrl: string | null = null;
  avatarCropZoom = 1;
  avatarCropError: string | null = null;
  private avatarImage: HTMLImageElement | null = null;

  hasUnsavedChanges(): boolean {
    return this.account.profileHasUnsavedChanges();
  }

  discardUnsavedChanges(): void {
    this.account.discardProfileChanges();
  }

  get avatarCropReady(): boolean {
    return Boolean(this.avatarCropUrl && this.avatarImage && !this.avatarCropError);
  }

  get avatarCropTransform(): string {
    const raw = Number(this.avatarCropZoom);
    const zoom = Number.isFinite(raw) ? Math.max(1, Math.min(raw, 3)) : 1;
    return `translate(-50%, -50%) scale(${zoom})`;
  }

  onAvatarFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return;

    this.resetAvatarCrop();
    const url = URL.createObjectURL(file);
    this.avatarCropUrl = url;
    this.avatarCropOpen = true;
    this.avatarCropZoom = 1;
    this.avatarCropError = null;
    const img = new Image();
    img.onload = () => {
      this.avatarImage = img;
    };
    img.onerror = () => {
      this.avatarCropError = 'Could not load image preview.';
    };
    img.src = url;
  }

  cancelAvatarCrop(): void {
    if (this.account.avatarBusy) return;
    this.resetAvatarCrop();
  }

  async confirmAvatarCrop(): Promise<void> {
    if (this.account.avatarBusy) return;
    if (!this.avatarImage) return;
    const url = this.avatarCropUrl;
    if (!url) return;

    const raw = Number(this.avatarCropZoom);
    const zoom = Number.isFinite(raw) ? Math.max(1, Math.min(raw, 3)) : 1;
    const canvas = document.createElement('canvas');
    const size = 512;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.resetAvatarCrop();
      return;
    }

    const img = this.avatarImage;
    const base = Math.min(img.naturalWidth, img.naturalHeight);
    const crop = base / zoom;
    const sx = (img.naturalWidth - crop) / 2;
    const sy = (img.naturalHeight - crop) / 2;
    ctx.drawImage(img, sx, sy, crop, crop, 0, 0, size, size);

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png', 0.92));
    if (!blob) {
      this.resetAvatarCrop();
      return;
    }

    this.resetAvatarCrop();
    const file = new File([blob], 'avatar.png', { type: blob.type });
    this.account.uploadAvatar(file);
  }

  ngOnDestroy(): void {
    this.resetAvatarCrop();
  }

  private resetAvatarCrop(): void {
    this.avatarCropOpen = false;
    this.avatarCropZoom = 1;
    this.avatarImage = null;
    this.avatarCropError = null;
    if (this.avatarCropUrl) {
      URL.revokeObjectURL(this.avatarCropUrl);
      this.avatarCropUrl = null;
    }
  }
}
