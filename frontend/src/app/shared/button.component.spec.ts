import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';

import { ButtonComponent } from './button.component';

describe('ButtonComponent', () => {
  let fixture: ComponentFixture<ButtonComponent>;
  let component: ButtonComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ButtonComponent],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(ButtonComponent);
    component = fixture.componentInstance;
  });

  it('renders a plain button by default', () => {
    component.label = 'Save';
    fixture.detectChanges();
    const button = fixture.debugElement.query(By.css('button'));
    expect(button).toBeTruthy();
    expect(button.nativeElement.textContent).toContain('Save');
  });

  it('emits action on a button click', () => {
    const spy = jasmine.createSpy('action');
    component.action.subscribe(spy);
    fixture.detectChanges();
    fixture.debugElement.query(By.css('button')).nativeElement.click();
    expect(spy).toHaveBeenCalled();
  });

  it('does not emit action for non-button types', () => {
    component.type = 'submit';
    const spy = jasmine.createSpy('action');
    component.action.subscribe(spy);
    fixture.detectChanges();
    fixture.debugElement.query(By.css('button')).nativeElement.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it('prevents action and default when disabled', () => {
    component.disabled = true;
    const spy = jasmine.createSpy('action');
    component.action.subscribe(spy);
    const event = new MouseEvent('click');
    const prevent = spyOn(event, 'preventDefault');
    const stop = spyOn(event, 'stopPropagation');
    component.onClick(event);
    expect(spy).not.toHaveBeenCalled();
    expect(prevent).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it('renders a routerLink anchor', () => {
    component.routerLink = '/shop';
    component.label = 'Shop';
    fixture.detectChanges();
    const anchor = fixture.debugElement.query(By.css('a'));
    expect(anchor).toBeTruthy();
  });

  it('renders an href anchor when no routerLink', () => {
    component.href = 'https://example.com';
    fixture.detectChanges();
    const anchor = fixture.debugElement.query(By.css('a'));
    expect(anchor.nativeElement.getAttribute('href')).toBe('https://example.com');
  });

  it('omits href on a disabled anchor', () => {
    component.href = 'https://example.com';
    component.disabled = true;
    fixture.detectChanges();
    const anchor = fixture.debugElement.query(By.css('a'));
    expect(anchor.nativeElement.getAttribute('href')).toBeNull();
  });

  it('onAnchorClick is a no-op when enabled', () => {
    const event = new MouseEvent('click');
    const prevent = spyOn(event, 'preventDefault');
    component.onAnchorClick(event);
    expect(prevent).not.toHaveBeenCalled();
  });

  it('onAnchorClick prevents navigation when disabled', () => {
    component.disabled = true;
    const event = new MouseEvent('click');
    const prevent = spyOn(event, 'preventDefault');
    const stop = spyOn(event, 'stopPropagation');
    component.onAnchorClick(event);
    expect(prevent).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it('computes ghost and small classes', () => {
    component.variant = 'ghost';
    component.size = 'sm';
    expect(component.classes).toContain('border');
    expect(component.classes).toContain('text-sm');
  });

  it('computes disabled state classes', () => {
    component.disabled = true;
    expect(component.classes).toContain('cursor-not-allowed');
  });
});
