import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { ThemeResetFrameComponent, ThemeResetService } from './theme-reset-frame.component';

/**
 * A maximally-broken adversarial theme: poison every inheritable text property
 * on the light-DOM ancestors (`html`/`body`) AND stamp a spread of hostile
 * `--token` custom properties onto `:root`, exactly as a worst-case published
 * theme could. A theme-immune frame must render legibly regardless.
 */
const POISON_COLOR = 'rgb(255, 0, 255)';

function applyAdversarialTheme(): void {
  const root = document.documentElement;
  root.style.setProperty('color', POISON_COLOR, 'important');
  root.style.setProperty('background-color', POISON_COLOR, 'important');
  root.style.setProperty('font-family', 'Impact, fantasy', 'important');
  root.style.setProperty('font-size', '2px', 'important');
  document.body.style.setProperty('color', POISON_COLOR, 'important');
  document.body.style.setProperty('font-family', 'Impact, fantasy', 'important');
  // Hostile token values a broken published theme could push onto :root.
  for (const name of ['--ms-brand', '--ms-surface', '--ms-text', '--ms-accent']) {
    root.style.setProperty(name, '9999 9999 9999');
  }
}

function clearAdversarialTheme(): void {
  const root = document.documentElement;
  for (const prop of ['color', 'background-color', 'font-family', 'font-size']) {
    root.style.removeProperty(prop);
    document.body.style.removeProperty(prop);
  }
  for (const name of ['--ms-brand', '--ms-surface', '--ms-text', '--ms-accent']) {
    root.style.removeProperty(name);
  }
}

/**
 * A stand-in reset service. It exposes the real seam (`resetToDefault`) plus a
 * decoy `rollbackToVersion` spy that MUST never be touched — proving the panic
 * reset targets the seeded compiled-default, not a (possibly-broken) prior
 * snapshot.
 */
function makeResetService(behaviour: 'ok' | 'error' | 'pending'): {
  service: ThemeResetService & { rollbackToVersion: jasmine.Spy };
  resetSpy: jasmine.Spy;
  pending$: Subject<void>;
} {
  const pending$ = new Subject<void>();
  const resetSpy = jasmine.createSpy('resetToDefault').and.callFake(() => {
    if (behaviour === 'ok') return of(undefined);
    if (behaviour === 'error') return throwError(() => new Error('reset failed'));
    return pending$.asObservable();
  });
  const service = {
    resetToDefault: resetSpy,
    rollbackToVersion: jasmine.createSpy('rollbackToVersion'),
  } as ThemeResetService & { rollbackToVersion: jasmine.Spy };
  return { service, resetSpy, pending$ };
}

describe('ThemeResetFrameComponent', () => {
  let hosts: HTMLElement[] = [];

  function mount(behaviour: 'ok' | 'error' | 'pending') {
    const stub = makeResetService(behaviour);
    TestBed.configureTestingModule({
      imports: [ThemeResetFrameComponent],
      providers: [{ provide: ThemeResetService, useValue: stub.service }],
    });
    const fixture = TestBed.createComponent(ThemeResetFrameComponent);
    // Attach to the live document so shadow-DOM styles compute and focus works.
    document.body.appendChild(fixture.nativeElement);
    hosts.push(fixture.nativeElement);
    fixture.detectChanges();
    return { fixture, ...stub };
  }

  function shadow(fixture: { nativeElement: HTMLElement }): ShadowRoot {
    const root = fixture.nativeElement.shadowRoot;
    if (!root) throw new Error('expected a shadow root');
    return root;
  }

  function resetButton(fixture: { nativeElement: HTMLElement }): HTMLButtonElement {
    const btn = shadow(fixture).querySelector<HTMLButtonElement>('button.ms-reset-btn');
    if (!btn) throw new Error('expected a reset button');
    return btn;
  }

  afterEach(() => {
    clearAdversarialTheme();
    for (const host of hosts) host.remove();
    hosts = [];
    TestBed.resetTestingModule();
  });

  it('renders the reset control inside a theme-immune shadow root under a maximally-broken theme', () => {
    applyAdversarialTheme();
    const { fixture } = mount('ok');

    const btn = resetButton(fixture);
    expect(btn).withContext('reset control present in shadow root').toBeTruthy();

    // Baked-in CSS: the control keeps its own literal colours, NOT the poisoned
    // inherited `color`/`--token` values from `:root`.
    const btnStyle = getComputedStyle(btn);
    expect(btnStyle.color).toBe('rgb(255, 255, 255)');
    expect(btnStyle.backgroundColor).toBe('rgb(185, 28, 28)');
    expect(btnStyle.color).not.toBe(POISON_COLOR);

    const frame = shadow(fixture).querySelector<HTMLElement>('.ms-reset-frame');
    expect(frame).toBeTruthy();
    expect(getComputedStyle(frame as HTMLElement).color).toBe('rgb(11, 18, 32)');
  });

  it('never consumes an editable --token or var() in its baked stylesheet', () => {
    const { fixture } = mount('ok');
    const styleText = Array.from(shadow(fixture).querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n');
    expect(styleText.length).toBeGreaterThan(0);
    expect(styleText).not.toContain('var(--');
  });

  it('keeps the reset control focusable and clickable under the broken theme', () => {
    applyAdversarialTheme();
    const { fixture, resetSpy } = mount('ok');
    const btn = resetButton(fixture);

    btn.focus();
    expect(shadow(fixture).activeElement).toBe(btn);

    btn.click();
    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  it('invokes resetToDefault exactly once per click and never a prior-snapshot rollback', () => {
    const { fixture, service, resetSpy } = mount('ok');

    resetButton(fixture).click();

    expect(resetSpy).toHaveBeenCalledTimes(1);
    // The target is the seeded compiled-default, not a historical rollback.
    expect(service.rollbackToVersion).not.toHaveBeenCalled();
  });

  it('marks success and emits done when the reset resolves', () => {
    const { fixture } = mount('ok');
    const cmp = fixture.componentInstance;
    const done: number[] = [];
    cmp.done.subscribe(() => done.push(1));

    resetButton(fixture).click();
    fixture.detectChanges();

    expect(cmp.status).toBe('done');
    expect(done.length).toBe(1);
    const status = shadow(fixture).querySelector('[role="status"]');
    expect(status?.textContent).toContain(cmp.doneLabel);
  });

  it('marks error and emits failed when the reset rejects', () => {
    const { fixture } = mount('error');
    const cmp = fixture.componentInstance;
    const failed: number[] = [];
    cmp.failed.subscribe(() => failed.push(1));

    resetButton(fixture).click();
    fixture.detectChanges();

    expect(cmp.status).toBe('error');
    expect(failed.length).toBe(1);
    const alert = shadow(fixture).querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(cmp.errorLabel);
  });

  it('guards against a double-click while a reset is already pending', () => {
    const { fixture, resetSpy, pending$ } = mount('pending');
    const cmp = fixture.componentInstance;
    const btn = resetButton(fixture);

    btn.click();
    fixture.detectChanges();
    expect(cmp.status).toBe('pending');
    // The button disables while pending; drive a second call directly too.
    expect(btn.disabled).toBe(true);
    cmp.reset();

    expect(resetSpy).toHaveBeenCalledTimes(1);

    // Completing the in-flight request settles the state (status is a model
    // property set synchronously by the subscriber; no DOM assertion follows,
    // so no detectChanges — a settle-time CD trips NG0100 on the disabled attr).
    pending$.next();
    pending$.complete();
    expect(cmp.status).toBe('done');
  });

  it('exposes overridable labels for the panic frame', () => {
    const { fixture } = mount('ok');
    // setInput marks the view for check the way real input binding does; direct
    // instance assignment does not, and tripped NG0100 under checkNoChanges.
    fixture.componentRef.setInput('heading', 'Emergency');
    fixture.componentRef.setInput('buttonLabel', 'Restore defaults');
    fixture.componentRef.setInput('ariaLabel', 'Restore the safe default theme');
    fixture.detectChanges();

    const btn = resetButton(fixture);
    expect(btn.textContent).toContain('Restore defaults');
    expect(btn.getAttribute('aria-label')).toBe('Restore the safe default theme');
    expect(shadow(fixture).querySelector('.ms-reset-heading')?.textContent).toContain('Emergency');
  });
});
