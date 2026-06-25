import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';

import { EmptyStateComponent } from './empty-state.component';

describe('EmptyStateComponent', () => {
  let fixture: ComponentFixture<EmptyStateComponent>;
  let component: EmptyStateComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [EmptyStateComponent, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(EmptyStateComponent);
    component = fixture.componentInstance;
  });

  it('renders the icon, title, and copy', () => {
    component.icon = '*';
    component.title = 'Nothing here';
    component.copy = 'Try again later';
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('*');
    expect(text).toContain('Nothing here');
    expect(text).toContain('Try again later');
  });

  it('hides the icon and copy when not provided', () => {
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[aria-hidden="true"]'))).toBeNull();
  });

  it('shows action buttons when label keys are set', () => {
    component.primaryActionLabelKey = 'cta.primary';
    component.secondaryActionLabelKey = 'cta.secondary';
    fixture.detectChanges();
    expect(fixture.debugElement.queryAll(By.css('app-button')).length).toBe(2);
  });

  it('emits primaryAction only when there is no url', () => {
    const spy = jasmine.createSpy('primary');
    component.primaryAction.subscribe(spy);
    component.onPrimaryAction();
    expect(spy).toHaveBeenCalledTimes(1);
    component.primaryActionUrl = '/go';
    component.onPrimaryAction();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits secondaryAction only when there is no url', () => {
    const spy = jasmine.createSpy('secondary');
    component.secondaryAction.subscribe(spy);
    component.onSecondaryAction();
    expect(spy).toHaveBeenCalledTimes(1);
    component.secondaryActionUrl = '/go';
    component.onSecondaryAction();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
