import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { ThemeSegmentedControlComponent } from './theme-segmented-control.component';

describe('ThemeSegmentedControlComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), ThemeSegmentedControlComponent],
    });
  });

  function getButtons(fixture: any): HTMLButtonElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button[role="radio"]'),
    ) as HTMLButtonElement[];
  }

  it('renders 3 theme options and emits selection', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const cmp = fixture.componentInstance;
    cmp.preference = 'system';
    fixture.detectChanges();

    const emitted: string[] = [];
    cmp.preferenceChange.subscribe((v) => emitted.push(v));

    const buttons = getButtons(fixture);
    expect(buttons.length).toBe(3);

    buttons[1].click(); // light
    expect(emitted).toEqual(['light']);
  });

  it('supports arrow navigation and moves focus', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const cmp = fixture.componentInstance;
    cmp.preference = 'system';
    fixture.detectChanges();

    const emitted: string[] = [];
    cmp.preferenceChange.subscribe((v) => {
      emitted.push(v);
      cmp.preference = v;
      fixture.detectChanges();
    });

    let buttons = getButtons(fixture);
    buttons[0].focus();
    expect(document.activeElement).toBe(buttons[0]);

    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    buttons = getButtons(fixture);
    expect(emitted).toEqual(['light']);
    expect(document.activeElement).toBe(buttons[1]);

    buttons[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    buttons = getButtons(fixture);
    expect(emitted).toEqual(['light', 'dark']);
    expect(document.activeElement).toBe(buttons[2]);

    buttons[2].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    buttons = getButtons(fixture);
    expect(emitted).toEqual(['light', 'dark', 'system']);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('supports Home/End keys', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const cmp = fixture.componentInstance;
    cmp.preference = 'dark';
    fixture.detectChanges();

    const emitted: string[] = [];
    cmp.preferenceChange.subscribe((v) => {
      emitted.push(v);
      cmp.preference = v;
      fixture.detectChanges();
    });

    let buttons = getButtons(fixture);
    buttons[2].focus();

    buttons[2].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
    );
    buttons = getButtons(fixture);
    expect(emitted).toEqual(['system']);
    expect(document.activeElement).toBe(buttons[0]);

    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    );
    buttons = getButtons(fixture);
    expect(emitted).toEqual(['system', 'dark']);
    expect(document.activeElement).toBe(buttons[2]);
  });

  it('ArrowLeft wraps from the first option to the last', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const cmp = fixture.componentInstance;
    cmp.preference = 'system';
    fixture.detectChanges();
    const emitted: string[] = [];
    cmp.preferenceChange.subscribe((v) => emitted.push(v));

    const buttons = getButtons(fixture);
    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    );
    expect(emitted).toEqual(['dark']);
  });

  it('ArrowLeft from a middle option moves to the previous option', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const cmp = fixture.componentInstance;
    cmp.preference = 'light';
    fixture.detectChanges();
    const emitted: string[] = [];
    cmp.preferenceChange.subscribe((v) => emitted.push(v));

    const buttons = getButtons(fixture);
    buttons[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    );
    expect(emitted).toEqual(['system']);
  });

  it('uses the small stacked icon box', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const cmp = fixture.componentInstance;
    cmp.layout = 'stacked';
    cmp.size = 'sm';
    expect(cmp.iconBoxClass()).toBe('h-7 w-7');
  });

  it('Enter and Space select the focused option without moving focus', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const cmp = fixture.componentInstance;
    cmp.preference = 'system';
    fixture.detectChanges();
    const emitted: string[] = [];
    cmp.preferenceChange.subscribe((v) => emitted.push(v));

    cmp.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }), 1);
    cmp.onKeyDown(new KeyboardEvent('keydown', { key: ' ' }), 2);
    expect(emitted).toEqual(['light', 'dark']);
  });

  it('ignores keys outside the navigation set', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const cmp = fixture.componentInstance;
    const emitted: string[] = [];
    cmp.preferenceChange.subscribe((v) => emitted.push(v));
    cmp.onKeyDown(new KeyboardEvent('keydown', { key: 'Tab' }), 0);
    expect(emitted).toEqual([]);
  });

  it('focusOption is a no-op when there is no radiogroup container', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const cmp = fixture.componentInstance;
    const orphan = document.createElement('button');
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    Object.defineProperty(event, 'currentTarget', { value: orphan });
    expect(() => cmp.onKeyDown(event, 0)).not.toThrow();
  });

  it('builds class variants across all input combinations', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const cmp = fixture.componentInstance;

    cmp.stretch = true;
    cmp.variant = 'embedded';
    cmp.size = 'lg';
    cmp.layout = 'stacked';
    cmp.showLabels = true;
    let root = cmp.rootClass();
    expect(root).toContain('flex');
    expect(root).toContain('w-full');
    expect(root).toContain('gap-1');
    expect(cmp.buttonNgClass('system')).toContain('flex-1');
    expect(cmp.buttonNgClass('system')).toContain('flex-col');
    expect(cmp.iconBoxClass()).toBe('h-8 w-8');
    expect(cmp.labelClass()).toContain('pb-0.5');
    expect(cmp.buttonClass('system')).toContain('min-h-10');

    cmp.stretch = false;
    cmp.variant = 'standalone';
    cmp.size = 'sm';
    cmp.layout = 'horizontal';
    cmp.showLabels = true;
    root = cmp.rootClass();
    expect(root).toContain('inline-flex');
    expect(root).toContain('border');
    expect(root).toContain('gap-0.5');
    expect(cmp.buttonNgClass('light')).toContain('gap-2');
    expect(cmp.iconBoxClass()).toBe('h-8 w-8');
    expect(cmp.labelClass()).toContain('pl-0');
    cmp.size = 'lg';
    expect(cmp.iconBoxClass()).toBe('h-9 w-9');
    expect(cmp.labelClass()).toContain('pl-0.5');

    cmp.showLabels = false;
    expect(cmp.buttonNgClass('dark')).not.toContain('gap-2');
  });
});
