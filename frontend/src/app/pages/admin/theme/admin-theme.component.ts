/**
 * Admin theme-editor (P1a WU10).
 *
 * The curated admin surface for the seventeen ADMIN-EDITABLE tokens — nine
 * colours, two fonts + a type-scale, five spacing anchors — grouped into three
 * editorial sections (Colour / Typography / Spacing). Every edit is routed
 * through the STRICT `validateAdminEditable` gate (WU2) before it reaches the
 * WU11 scoped live preview, so a derived / ramp / unknown key can never be set
 * from here. Colour edits are additionally run through the WU8-ux pairing
 * validator: a failing AA pairing surfaces an actionable warning plus one-click
 * auto-snap candidates. Save / publish / rollback / reset call the WU4a+WU4b
 * endpoints via {@link AdminThemeService}, with the staleness-409 and
 * contrast-422 error states surfaced explicitly; the in-editor stale-view signal
 * (N4) warns when the draft moved under the editor before the user invests more
 * edits.
 *
 * The editor CHROME is deliberately painted with the baked slate/indigo Tailwind
 * primitives — never the `var(--token)` theme being edited — so editing the
 * storefront theme never repaints the admin tool itself. The WU11 preview and
 * the WU9 panic-reset frame are the only theme-driven surfaces on the page, and
 * both are self-scoped.
 */

import { HttpErrorResponse } from '@angular/common/http';
import {
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  HostListener,
  type OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { validateAdminEditable } from '../../../core/theme/token-validation';
import {
  type ChangeValidation,
  type SnapCandidate,
  validateTokenChange,
} from '../../../core/theme/pairing-validator';
import {
  ThemeResetFrameComponent,
  ThemeResetService,
} from '../../../shared/theme-reset-frame.component';
import { AdminThemeService, type ThemeVersionListItem } from './admin-theme.service';
import {
  ALL_CONTROLS,
  EDITOR_GROUPS,
  type EditorControl,
  colorControlNames,
  compiledDefault,
  hexToTriplet,
  tripletToHex,
} from './theme-editor-controls';
import { ThemeLivePreviewComponent } from './theme-live-preview.component';

/** A transient result banner shown after a save / publish / rollback action. */
interface Feedback {
  readonly tone: 'success' | 'error';
  readonly msgKey: string;
}

@Component({
  selector: 'app-admin-theme',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, ThemeLivePreviewComponent, ThemeResetFrameComponent],
  providers: [{ provide: ThemeResetService, useExisting: AdminThemeService }],
  templateUrl: './admin-theme.component.html',
})
export class AdminThemeComponent implements OnInit, AfterViewInit {
  private readonly service = inject(AdminThemeService);

  /** The WU11 scoped live preview — the editor pushes in-progress edits here. */
  @ViewChild(ThemeLivePreviewComponent) private preview?: ThemeLivePreviewComponent;

  /** The three editor sections (Colour / Typography / Spacing). */
  protected readonly groups = EDITOR_GROUPS;

  /** Current working values for every editable token (name -> value). */
  protected readonly values = signal<Record<string, string>>({});
  /** Per-colour-token contrast failures (WU8-ux), keyed by token name. */
  protected readonly contrast = signal<Record<string, ChangeValidation>>({});
  /** Browsable version history (newest first). */
  protected readonly versions = signal<readonly ThemeVersionListItem[]>([]);

  /** True once the initial draft load has resolved (success or failure). */
  protected readonly loaded = signal(false);
  /** True while a save / publish / rollback / reset request is in flight. */
  protected readonly busy = signal(false);
  /** True when the working values diverge from the last-saved draft. */
  protected readonly dirty = signal(false);
  /** True when the draft moved on the server under this editor (N4). */
  protected readonly staleView = signal(false);
  /** The transient action-result banner. */
  protected readonly feedback = signal<Feedback | null>(null);

  /** True when any colour pairing currently fails its AA target. */
  protected readonly hasContrastFailures = computed(() => Object.keys(this.contrast()).length > 0);

  /** The last-saved draft snapshot — the discard target + dirty baseline. */
  private baseline: Record<string, string> = {};
  /** The version the working draft is based on (publish `expected_version`). */
  private baselineVersion = 0;
  /** The colour-control names, cached (the pairing overlay key set). */
  private readonly colorNames = colorControlNames();

  ngOnInit(): void {
    this.reload();
  }

  ngAfterViewInit(): void {
    this.syncPreview();
  }

  // --------------------------------------------------------------------- load

  /** (Re)load the draft + version history and reseed the editor + preview. */
  protected reload(): void {
    this.service.getDraft().subscribe({
      next: (draft) => {
        const seeded: Record<string, string> = {};
        for (const control of ALL_CONTROLS) {
          seeded[control.name] = draft.tokens[control.name] ?? compiledDefault(control.name);
        }
        this.values.set(seeded);
        this.baseline = { ...seeded };
        this.baselineVersion = draft.version;
        this.dirty.set(false);
        this.staleView.set(false);
        this.contrast.set({});
        this.loaded.set(true);
        this.syncPreview();
      },
      error: () => {
        this.loaded.set(true);
        this.feedback.set({ tone: 'error', msgKey: 'adminUi.theme.errors.load' });
      },
    });
    this.service.listVersions().subscribe({
      next: (response) => this.versions.set(response.items),
      error: () => this.versions.set([]),
    });
  }

  /** Re-check for a stale view whenever the admin refocuses the window (N4). */
  @HostListener('window:focus')
  protected checkStale(): void {
    if (!this.loaded()) return;
    this.service.getDraft().subscribe({
      next: (draft) => {
        if (draft.version !== this.baselineVersion) {
          this.staleView.set(true);
        }
      },
      error: () => {
        /* a transient focus-poll failure is non-fatal — leave the view as is */
      },
    });
  }

  // ------------------------------------------------------------------- editing

  /** Colour picker (hex) -> frozen `R G B` triplet edit. */
  protected onColorHex(name: string, event: Event): void {
    const hex = (event.target as HTMLInputElement).value;
    this.applyEdit(name, hexToTriplet(hex));
  }

  /** Direct `R G B` text-entry edit for a colour token. */
  protected onTriplet(name: string, event: Event): void {
    this.applyEdit(name, (event.target as HTMLInputElement).value);
  }

  /** Enum-control (font / type-scale / spacing) edit. */
  protected onSelect(name: string, event: Event): void {
    this.applyEdit(name, (event.target as HTMLSelectElement).value);
  }

  /** Apply one auto-snap candidate for a failing colour token. */
  protected applySnap(candidate: SnapCandidate): void {
    this.applyEdit(candidate.token, candidate.value);
  }

  /**
   * The central edit path: STRICT admin-editable validation, then apply to the
   * scoped preview + re-evaluate contrast for colours. A non-admin-editable /
   * unknown name (empty compiled default) is dropped without touching state —
   * the client mirror of the server draft-save gate.
   */
  private applyEdit(name: string, raw: string): void {
    const result = validateAdminEditable(name, raw);
    if (!result.ok && result.value === '') {
      return;
    }
    const next = { ...this.values(), [name]: result.value };
    this.values.set(next);
    this.preview?.applyToken(name, result.value);
    if (this.colorNames.includes(name)) {
      this.evaluateContrast(name, result.value, next);
    }
    this.recomputeDirty();
  }

  /** Re-run the WU8-ux pairing validator for a changed colour token. */
  private evaluateContrast(name: string, value: string, all: Record<string, string>): void {
    const overlay: Record<string, string> = {};
    for (const colorName of this.colorNames) {
      overlay[colorName] = all[colorName];
    }
    const result = validateTokenChange(name, value, overlay);
    const map = { ...this.contrast() };
    if (result.ok) {
      delete map[name];
    } else {
      map[name] = result;
    }
    this.contrast.set(map);
  }

  // ------------------------------------------------------------------- actions

  /** Save the working values as the draft (server-revalidated + audited). */
  protected save(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.service.saveDraft(this.values()).subscribe({
      next: (draft) => {
        this.baseline = { ...this.values() };
        this.baselineVersion = draft.version;
        this.dirty.set(false);
        this.busy.set(false);
        this.feedback.set({ tone: 'success', msgKey: 'adminUi.theme.feedback.saved' });
      },
      error: () => this.fail('adminUi.theme.errors.save'),
    });
  }

  /** Atomically publish the saved draft, surfacing 409 / 422 explicitly. */
  protected publish(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.service.publish(this.baselineVersion).subscribe({
      next: (published) => {
        this.baselineVersion = published.version;
        this.busy.set(false);
        this.staleView.set(false);
        this.feedback.set({ tone: 'success', msgKey: 'adminUi.theme.feedback.published' });
        this.refreshVersions();
      },
      error: (error: unknown) => this.failPublish(error),
    });
  }

  /** Wholesale-restore a prior published version, then reseed from the server. */
  protected rollback(version: number): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.service.rollback(version).subscribe({
      next: () => {
        this.busy.set(false);
        this.feedback.set({ tone: 'success', msgKey: 'adminUi.theme.feedback.rolledBack' });
        this.reload();
      },
      error: () => this.fail('adminUi.theme.errors.rollback'),
    });
  }

  /** Force-publish the seeded compiled defaults, then reseed from the server. */
  protected reset(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.service.resetToDefault().subscribe({
      next: () => {
        this.busy.set(false);
        this.feedback.set({ tone: 'success', msgKey: 'adminUi.theme.feedback.reset' });
        this.reload();
      },
      error: () => this.fail('adminUi.theme.errors.reset'),
    });
  }

  /** After the WU9 panic frame resets, reseed the editor from the safe default. */
  protected onPanicReset(): void {
    this.reload();
  }

  private refreshVersions(): void {
    this.service.listVersions().subscribe({
      next: (response) => this.versions.set(response.items),
      error: () => this.versions.set([]),
    });
  }

  private fail(msgKey: string): void {
    this.busy.set(false);
    this.feedback.set({ tone: 'error', msgKey });
  }

  private failPublish(error: unknown): void {
    if (error instanceof HttpErrorResponse && error.status === 409) {
      this.staleView.set(true);
      this.fail('adminUi.theme.errors.stale');
      return;
    }
    if (error instanceof HttpErrorResponse && error.status === 422) {
      this.fail('adminUi.theme.errors.contrast');
      return;
    }
    this.fail('adminUi.theme.errors.publish');
  }

  // ------------------------------------------------------- template view model

  /** The current value of a token (empty string when unseeded). */
  protected currentValue(name: string): string {
    return this.values()[name] ?? '';
  }

  /** The `#rrggbb` mirror of a colour token for the native picker. */
  protected hexFor(name: string): string {
    return tripletToHex(this.currentValue(name));
  }

  /** The contrast failure for a colour token, or `undefined` when it passes. */
  protected contrastFor(name: string): ChangeValidation | undefined {
    return this.contrast()[name];
  }

  /** Whether publishing is currently blocked (and why the button is disabled). */
  protected get publishDisabled(): boolean {
    return this.busy() || this.dirty() || this.hasContrastFailures();
  }

  /** Round a WCAG ratio to one decimal for display (avoids a DecimalPipe dep). */
  protected fmt(ratio: number): number {
    return Math.round(ratio * 10) / 10;
  }

  /** Track function for the control @for loop. */
  protected trackControl(_index: number, control: EditorControl): string {
    return control.name;
  }

  /** Track function for the version @for loop. */
  protected trackVersion(_index: number, version: ThemeVersionListItem): number {
    return version.version;
  }

  // ------------------------------------------------ unsaved-changes guard seam

  /** `unsavedChangesGuard` contract: block navigation on an unsaved draft. */
  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  /** `unsavedChangesGuard` contract: revert to the last-saved draft. */
  discardUnsavedChanges(): void {
    const restored = { ...this.baseline };
    this.values.set(restored);
    this.contrast.set({});
    this.dirty.set(false);
    this.syncPreview();
  }

  // ------------------------------------------------------------------ internal

  private recomputeDirty(): void {
    const current = this.values();
    const changed = ALL_CONTROLS.some(
      (control) => current[control.name] !== this.baseline[control.name],
    );
    this.dirty.set(changed);
  }

  /** Mirror every current value onto the scoped preview (idempotent). */
  private syncPreview(): void {
    if (!this.preview) return;
    for (const [name, value] of Object.entries(this.values())) {
      this.preview.applyToken(name, value);
    }
  }
}
