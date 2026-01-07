import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { ThemeSegmentedControlComponent } from './theme-segmented-control.component';

describe('ThemeSegmentedControlComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), ThemeSegmentedControlComponent]
    });
  });

  it('renders 3 theme options and emits selection', () => {
    const fixture = TestBed.createComponent(ThemeSegmentedControlComponent);
    const cmp = fixture.componentInstance;
    cmp.preference = 'system';
    fixture.detectChanges();

    const emitted: string[] = [];
    cmp.preferenceChange.subscribe((v) => emitted.push(v));

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button[role="radio"]')) as HTMLButtonElement[];
    expect(buttons.length).toBe(3);

    buttons[1].click(); // light
    expect(emitted).toEqual(['light']);
  });
});

