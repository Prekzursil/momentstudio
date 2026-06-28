import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { SpinnerComponent } from './spinner.component';

describe('SpinnerComponent', () => {
  let fixture: ComponentFixture<SpinnerComponent>;
  let component: SpinnerComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SpinnerComponent],
    });
    fixture = TestBed.createComponent(SpinnerComponent);
    component = fixture.componentInstance;
  });

  it('defaults to an empty label and non-inline layout', () => {
    expect(component.label).toBe('');
    expect(component.inline).toBe(false);
  });

  it('always renders the spinning indicator span', () => {
    fixture.detectChanges();
    const indicator = fixture.debugElement.query(By.css('span.animate-spin'));
    expect(indicator).not.toBeNull();
    expect(indicator.nativeElement.classList).toContain('rounded-full');
  });

  it('hides the label span when no label is provided', () => {
    fixture.detectChanges();
    const labelSpan = fixture.debugElement.query(By.css('span.text-slate-600'));
    expect(labelSpan).toBeNull();
  });

  it('renders the label text when a label is set', () => {
    component.label = 'Loading orders';
    fixture.detectChanges();
    const labelSpan = fixture.debugElement.query(By.css('span.text-slate-600'));
    expect(labelSpan).not.toBeNull();
    expect(labelSpan.nativeElement.textContent.trim()).toBe('Loading orders');
  });

  it('uses flex layout by default (inline false)', () => {
    fixture.detectChanges();
    const wrapper = fixture.debugElement.query(By.css('div'));
    expect(wrapper.nativeElement.classList).toContain('flex');
    expect(wrapper.nativeElement.classList).not.toContain('inline-flex');
  });

  it('uses inline-flex layout when inline is true', () => {
    component.inline = true;
    fixture.detectChanges();
    const wrapper = fixture.debugElement.query(By.css('div'));
    expect(wrapper.nativeElement.classList).toContain('inline-flex');
  });
});
