import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';

import { ThemeLivePreviewComponent } from './theme-live-preview.component';
import {
  AdminThemeService,
  type ThemeTokensRead,
  type ThemeVersionListResponse,
} from './admin-theme.service';
import { AdminThemeComponent } from './admin-theme.component';

/** A draft that seeds SOME tokens (others fall back to compiled defaults). */
const DRAFT: ThemeTokensRead = {
  tokens: { '--accent': '79 70 229', '--text': '51 65 85', '--background': '255 255 255' },
  version: 5,
  schema_version: 1,
  status: 'draft',
};

const PUBLISHED: ThemeTokensRead = { ...DRAFT, version: 6, status: 'published' };

const VERSIONS: ThemeVersionListResponse = {
  items: [
    { version: 6, schema_version: 1, status: 'published', created_at: '2026-07-04T00:00:00Z' },
    { version: 5, schema_version: 1, status: 'draft', created_at: '2026-07-03T00:00:00Z' },
  ],
};

type Spy = jasmine.SpyObj<AdminThemeService>;

function makeService(): Spy {
  const service = jasmine.createSpyObj<AdminThemeService>('AdminThemeService', [
    'getPublished',
    'getDraft',
    'listVersions',
    'saveDraft',
    'publish',
    'rollback',
    'resetToDefault',
  ]);
  service.getDraft.and.returnValue(of(DRAFT));
  service.listVersions.and.returnValue(of(VERSIONS));
  service.saveDraft.and.returnValue(of(PUBLISHED));
  service.publish.and.returnValue(of(PUBLISHED));
  service.rollback.and.returnValue(of(PUBLISHED));
  service.resetToDefault.and.returnValue(of(PUBLISHED));
  service.getPublished.and.returnValue(of(PUBLISHED));
  return service;
}

async function mount(
  service: Spy,
): Promise<{ fixture: ComponentFixture<AdminThemeComponent>; cmp: AdminThemeComponent }> {
  await TestBed.configureTestingModule({
    imports: [TranslateModule.forRoot(), AdminThemeComponent],
    providers: [{ provide: AdminThemeService, useValue: service }],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminThemeComponent);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance };
}

/** Access protected members for white-box assertions. */
function internal(cmp: AdminThemeComponent): {
  applyEdit(name: string, raw: string): void;
  busy: { set(v: boolean): void };
  checkStale(): void;
  currentValue(name: string): string;
  hexFor(name: string): string;
  publishDisabled: boolean;
  contrastFor(name: string): unknown;
  save(): void;
  publish(): void;
  rollback(v: number): void;
  reset(): void;
  onPanicReset(): void;
  fmt(n: number): number;
  preview: ThemeLivePreviewComponent;
} {
  return cmp as unknown as ReturnType<typeof internal>;
}

describe('AdminThemeComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('loads the draft and renders the 17 curated controls, grouped', async () => {
    const service = makeService();
    const { fixture } = await mount(service);
    const host = fixture.nativeElement as HTMLElement;

    expect(service.getDraft).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('fieldset').length).toBe(3);
    expect(host.querySelectorAll('input[type=color]').length).toBe(9);
    expect(host.querySelectorAll('input[type=text]').length).toBe(9);
    // 2 fonts + 1 type-scale + 5 spacing = 8 enum selects.
    expect(host.querySelectorAll('select').length).toBe(8);
    // Onboarding: the discoverable title + intro copy are present (N5).
    expect(host.querySelector('#theme-editor-title')).not.toBeNull();
  });

  it('seeds omitted tokens from the compiled defaults', async () => {
    const { cmp } = await mount(makeService());
    // --accent came from the draft...
    expect(internal(cmp).currentValue('--accent')).toBe('79 70 229');
    // ...--surface was absent from the draft, so it seeds from the taxonomy default.
    expect(internal(cmp).currentValue('--surface')).toBe('241 245 249');
    // An unknown token yields the empty-string fallback.
    expect(internal(cmp).currentValue('--nope')).toBe('');
  });

  it('routes a colour edit through validateAdminEditable to the scoped preview', async () => {
    const { cmp } = await mount(makeService());
    const applySpy = spyOn(internal(cmp).preview, 'applyToken').and.callThrough();

    const event = { target: { value: '10 20 30' } } as unknown as Event;
    (cmp as unknown as { onTriplet(name: string, e: Event): void }).onTriplet('--accent', event);

    expect(internal(cmp).currentValue('--accent')).toBe('10 20 30');
    expect(applySpy).toHaveBeenCalledWith('--accent', '10 20 30');
    expect(cmp.hasUnsavedChanges()).toBeTrue();
  });

  it('maps the colour picker hex to the frozen R G B triplet', async () => {
    const { cmp } = await mount(makeService());
    const event = { target: { value: '#0f172a' } } as unknown as Event;
    (cmp as unknown as { onColorHex(n: string, e: Event): void }).onColorHex('--background', event);
    expect(internal(cmp).currentValue('--background')).toBe('15 23 42');
    expect(internal(cmp).hexFor('--accent')).toBe('#4f46e5');
  });

  it('applies the compiled default when a colour value is a breakout attempt', async () => {
    const { cmp } = await mount(makeService());
    const event = { target: { value: '9 9 9) } html{background:red' } } as unknown as Event;
    (cmp as unknown as { onTriplet(n: string, e: Event): void }).onTriplet('--background', event);
    // The tainted value never lands; the WU2 compiled default is applied.
    expect(internal(cmp).currentValue('--background')).toBe('255 255 255');
  });

  it('drops a derived / ramp key client-side (never reaches the preview)', async () => {
    const { cmp } = await mount(makeService());
    const applySpy = spyOn(internal(cmp).preview, 'applyToken');
    internal(cmp).applyEdit('--surface-muted', '10 20 30');
    expect(internal(cmp).currentValue('--surface-muted')).toBe('');
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('changes a font / spacing token via its enum select', async () => {
    const { cmp } = await mount(makeService());
    const event = { target: { value: '1.5rem' } } as unknown as Event;
    (cmp as unknown as { onSelect(n: string, e: Event): void }).onSelect('--space-md', event);
    expect(internal(cmp).currentValue('--space-md')).toBe('1.5rem');
  });

  it('surfaces a contrast failure with actionable auto-snap and blocks publish', async () => {
    const { cmp, fixture } = await mount(makeService());
    // White text on the white page background fails AA body contrast.
    internal(cmp).applyEdit('--text', '255 255 255');
    fixture.detectChanges();

    const failure = internal(cmp).contrastFor('--text') as { candidates: { value: string }[] };
    expect(failure).toBeTruthy();
    expect(failure.candidates.length).toBeGreaterThan(0);
    expect(internal(cmp).publishDisabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();

    // One-click auto-snap clears the failure.
    const candidate = { token: '--text', value: failure.candidates[0].value } as never;
    (cmp as unknown as { applySnap(c: never): void }).applySnap(candidate);
    expect(internal(cmp).contrastFor('--text')).toBeUndefined();
  });

  it('saves the working draft and clears the dirty flag', async () => {
    const service = makeService();
    const { cmp } = await mount(service);
    internal(cmp).applyEdit('--accent', '10 20 30');
    expect(cmp.hasUnsavedChanges()).toBeTrue();

    internal(cmp).save();

    expect(service.saveDraft).toHaveBeenCalledWith(
      jasmine.objectContaining({ '--accent': '10 20 30' }),
    );
    expect(cmp.hasUnsavedChanges()).toBeFalse();
  });

  it('publishes the saved draft with the optimistic-concurrency version', async () => {
    const service = makeService();
    const { cmp } = await mount(service);
    internal(cmp).publish();
    expect(service.publish).toHaveBeenCalledWith(5);
  });

  it('surfaces a 409 as an explicit staleness state', async () => {
    const service = makeService();
    service.publish.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    const { cmp, fixture } = await mount(service);
    internal(cmp).publish();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('adminUi.theme.errors.stale');
    expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();
  });

  it('surfaces a 422 as an explicit contrast-rejection state', async () => {
    const service = makeService();
    service.publish.and.returnValue(throwError(() => new HttpErrorResponse({ status: 422 })));
    const { cmp, fixture } = await mount(service);
    internal(cmp).publish();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('adminUi.theme.errors.contrast');
  });

  it('surfaces any other publish error generically', async () => {
    const service = makeService();
    service.publish.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    const { cmp, fixture } = await mount(service);
    internal(cmp).publish();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('adminUi.theme.errors.publish');
  });

  it('surfaces a non-HTTP publish error generically', async () => {
    const service = makeService();
    service.publish.and.returnValue(throwError(() => new Error('boom')));
    const { cmp, fixture } = await mount(service);
    internal(cmp).publish();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('adminUi.theme.errors.publish');
  });

  it('rolls back a prior version, then reseeds from the server', async () => {
    const service = makeService();
    const { cmp } = await mount(service);
    service.getDraft.calls.reset();
    internal(cmp).rollback(4);
    expect(service.rollback).toHaveBeenCalledWith(4);
    // reload() reseeds after a successful rollback.
    expect(service.getDraft).toHaveBeenCalled();
  });

  it('resets to safe defaults and reseeds; the panic frame triggers a reload too', async () => {
    const service = makeService();
    const { cmp } = await mount(service);
    internal(cmp).reset();
    expect(service.resetToDefault).toHaveBeenCalled();

    service.getDraft.calls.reset();
    internal(cmp).onPanicReset();
    expect(service.getDraft).toHaveBeenCalledTimes(1);
  });

  it('discards unsaved changes back to the last-saved draft', async () => {
    const { cmp } = await mount(makeService());
    internal(cmp).applyEdit('--accent', '1 2 3');
    expect(cmp.hasUnsavedChanges()).toBeTrue();
    cmp.discardUnsavedChanges();
    expect(cmp.hasUnsavedChanges()).toBeFalse();
    expect(internal(cmp).currentValue('--accent')).toBe('79 70 229');
  });

  it('guards every action against re-entry while a request is in flight', async () => {
    const service = makeService();
    const { cmp } = await mount(service);
    internal(cmp).busy.set(true);
    internal(cmp).save();
    internal(cmp).publish();
    internal(cmp).rollback(1);
    internal(cmp).reset();
    expect(service.saveDraft).not.toHaveBeenCalled();
    expect(service.publish).not.toHaveBeenCalled();
    expect(service.rollback).not.toHaveBeenCalled();
    expect(service.resetToDefault).not.toHaveBeenCalled();
  });

  it('shows a save error when the draft-save fails', async () => {
    const service = makeService();
    service.saveDraft.and.returnValue(throwError(() => new Error('nope')));
    const { cmp, fixture } = await mount(service);
    internal(cmp).applyEdit('--accent', '1 2 3');
    internal(cmp).save();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('adminUi.theme.errors.save');
    expect(cmp.hasUnsavedChanges()).toBeTrue();
  });

  it('shows a rollback error and a reset error when those requests fail', async () => {
    const service = makeService();
    service.rollback.and.returnValue(throwError(() => new Error('x')));
    service.resetToDefault.and.returnValue(throwError(() => new Error('x')));
    const { cmp, fixture } = await mount(service);
    internal(cmp).rollback(2);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('adminUi.theme.errors.rollback');
    internal(cmp).reset();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('adminUi.theme.errors.reset');
  });

  it('shows a load error when the draft cannot be read', async () => {
    const service = makeService();
    service.getDraft.and.returnValue(throwError(() => new Error('down')));
    service.listVersions.and.returnValue(throwError(() => new Error('down')));
    const { fixture } = await mount(service);
    expect(fixture.nativeElement.textContent).toContain('adminUi.theme.errors.load');
  });

  it('flags a stale view when the draft moved on the server (N4)', async () => {
    const service = makeService();
    const { cmp, fixture } = await mount(service);
    // A later focus poll sees a newer server version.
    service.getDraft.and.returnValue(of({ ...DRAFT, version: 9 }));
    internal(cmp).checkStale();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('adminUi.theme.stale.message');
  });

  it('does not flag a stale view when the version is unchanged, and reloads on demand', async () => {
    const service = makeService();
    const { cmp, fixture } = await mount(service);
    internal(cmp).checkStale();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('adminUi.theme.stale.message');
    // The stale-banner reload path re-fetches the draft.
    service.getDraft.calls.reset();
    (cmp as unknown as { reload(): void }).reload();
    expect(service.getDraft).toHaveBeenCalledTimes(1);
  });

  it('tolerates a transient focus-poll failure without flagging stale', async () => {
    const service = makeService();
    const { cmp, fixture } = await mount(service);
    service.getDraft.and.returnValue(throwError(() => new Error('flaky')));
    internal(cmp).checkStale();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('adminUi.theme.stale.message');
  });

  it('ignores a stale check before the initial load resolves', async () => {
    const service = makeService();
    const pending = new Subject<ThemeTokensRead>();
    service.getDraft.and.returnValue(pending.asObservable());
    const { cmp } = await mount(service);
    service.getDraft.calls.reset();
    internal(cmp).checkStale();
    expect(service.getDraft).not.toHaveBeenCalled();
    pending.complete();
  });

  it('rounds a WCAG ratio for display', async () => {
    const { cmp } = await mount(makeService());
    expect(internal(cmp).fmt(4.567)).toBe(4.6);
  });

  it('tolerates a version-list refresh failure after a successful publish', async () => {
    const service = makeService();
    const { cmp } = await mount(service);
    service.listVersions.and.returnValue(throwError(() => new Error('flaky')));
    internal(cmp).publish();
    expect(cmp.hasUnsavedChanges()).toBeFalse();
    // The failed post-publish version refresh empties the list without throwing.
    expect((cmp as unknown as { versions(): unknown[] }).versions().length).toBe(0);
  });

  it('gates publish on busy, dirty, and contrast state independently', async () => {
    const { cmp } = await mount(makeService());
    // Fresh load: nothing blocks publishing.
    expect(internal(cmp).publishDisabled).toBeFalse();

    // A contrast failure alone blocks it (dirty stays false — set directly).
    (cmp as unknown as { contrast: { set(v: unknown): void } }).contrast.set({
      '--text': { ok: false },
    });
    expect(internal(cmp).publishDisabled).toBeTrue();
    (cmp as unknown as { contrast: { set(v: unknown): void } }).contrast.set({});

    // An unsaved edit alone blocks it.
    internal(cmp).applyEdit('--accent', '1 2 3');
    expect(internal(cmp).publishDisabled).toBeTrue();

    // An in-flight request alone blocks it.
    (cmp as unknown as { dirty: { set(v: boolean): void } }).dirty.set(false);
    internal(cmp).busy.set(true);
    expect(internal(cmp).publishDisabled).toBeTrue();
  });
});
