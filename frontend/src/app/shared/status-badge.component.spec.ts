import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { StatusBadgeComponent } from './status-badge.component';

describe('StatusBadgeComponent', () => {
  let fixture: ComponentFixture<StatusBadgeComponent>;
  let component: StatusBadgeComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusBadgeComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(StatusBadgeComponent);
    component = fixture.componentInstance;
  });

  it('creates', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('prefers explicit label over value/labelKey', () => {
    component.label = 'Explicit';
    component.value = 'paid';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('Explicit');
  });

  it('falls back to value when no label/labelKey', () => {
    component.value = 'paid';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('paid');
  });

  it('renders em dash when nothing provided', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('—');
  });

  it('renders translated labelKey when value is empty', () => {
    component.labelKey = 'some.key';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('some.key');
  });

  it('maps value to the green tone', () => {
    component.value = 'completed';
    fixture.detectChanges();
    expect(component.classes).toContain('emerald');
  });

  it('maps value to the blue tone', () => {
    component.value = 'shipped';
    fixture.detectChanges();
    expect(component.classes).toContain('indigo');
  });

  it('maps value to the amber tone', () => {
    component.value = 'pending';
    fixture.detectChanges();
    expect(component.classes).toContain('amber');
  });

  it('maps value to the rose tone', () => {
    component.value = 'cancelled';
    fixture.detectChanges();
    expect(component.classes).toContain('rose');
  });

  it('maps unknown value to the slate tone', () => {
    component.value = 'whatever';
    fixture.detectChanges();
    expect(component.classes).toContain('slate');
  });
});
