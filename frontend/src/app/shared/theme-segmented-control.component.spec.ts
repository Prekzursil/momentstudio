import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { ThemeSegmentedControlComponent } from './theme-segmented-control.component';

describe('ThemeSegmentedControlComponent', () => {
  registerThemeControlSetup();
  defineOptionRenderSpec();
  defineArrowNavigationSpec();
  defineHomeEndSpec();
});

function registerThemeControlSetup(): void {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), ThemeSegmentedControlComponent]
    });
  });
};

const getButtons = (fixture: any): HTMLButtonElement[] => {
  return Array.from(fixture.nativeElement.querySelectorAll('button[role="radio"]')) as HTMLButtonElement[];
};

function defineOptionRenderSpec(): void {
  it('renders 3 theme options and emits selection', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const component = fixture.componentInstance;
    component.preference = 'system';
    fixture.detectChanges();

    const emitted: string[] = [];
    component.preferenceChange.subscribe((value) => emitted.push(value));

    const buttons = getButtons(fixture);
    expect(buttons.length).toBe(3);

    buttons[1].click(); // light
    expect(emitted).toEqual(['light']);
  });
};

function defineArrowNavigationSpec(): void {
  it('supports arrow navigation and moves focus', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const component = fixture.componentInstance;
    component.preference = 'system';
    fixture.detectChanges();

    const emitted: string[] = [];
    component.preferenceChange.subscribe((value) => {
      emitted.push(value);
      component.preference = value;
      fixture.detectChanges();
    });

    let buttons = getButtons(fixture);
    buttons[0].focus();
    expect(document.activeElement).toBe(buttons[0]);

    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    buttons = getButtons(fixture);
    expect(emitted).toEqual(['light']);
    expect(document.activeElement).toBe(buttons[1]);

    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    buttons = getButtons(fixture);
    expect(emitted).toEqual(['light', 'dark']);
    expect(document.activeElement).toBe(buttons[2]);

    buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    buttons = getButtons(fixture);
    expect(emitted).toEqual(['light', 'dark', 'system']);
    expect(document.activeElement).toBe(buttons[0]);
  });
};

function defineHomeEndSpec(): void {
  it('supports Home/End keys', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const component = fixture.componentInstance;
    component.preference = 'dark';
    fixture.detectChanges();

    const emitted: string[] = [];
    component.preferenceChange.subscribe((value) => {
      emitted.push(value);
      component.preference = value;
      fixture.detectChanges();
    });

    let buttons = getButtons(fixture);
    buttons[2].focus();

    buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    buttons = getButtons(fixture);
    expect(emitted).toEqual(['system']);
    expect(document.activeElement).toBe(buttons[0]);

    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    buttons = getButtons(fixture);
    expect(emitted).toEqual(['system', 'dark']);
    expect(document.activeElement).toBe(buttons[2]);
  });
};
