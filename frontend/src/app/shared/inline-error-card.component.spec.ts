import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';

import { InlineErrorCardComponent } from './inline-error-card.component';

describe('InlineErrorCardComponent', () => {
  let fixture: ComponentFixture<InlineErrorCardComponent>;
  let component: InlineErrorCardComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InlineErrorCardComponent, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(InlineErrorCardComponent);
    component = fixture.componentInstance;
  });

  it('renders default retry, back and contact buttons', () => {
    fixture.detectChanges();
    expect(fixture.debugElement.queryAll(By.css('app-button')).length).toBe(3);
  });

  it('renders explicit title and message over keys', () => {
    component.title = 'Custom title';
    component.message = 'Custom message';
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Custom title');
    expect(text).toContain('Custom message');
  });

  it('shows the request id block with a copy button', () => {
    component.requestId = 'req-99';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('req-99');
    expect(fixture.debugElement.query(By.css('app-copy-button'))).toBeTruthy();
  });

  it('hides optional buttons when toggled off', () => {
    component.showRetry = false;
    component.showContact = false;
    component.backToUrl = null;
    fixture.detectChanges();
    expect(fixture.debugElement.queryAll(By.css('app-button')).length).toBe(0);
  });

  it('emits retry when the retry button fires', () => {
    const spy = jasmine.createSpy('retry');
    component.retry.subscribe(spy);
    component.retry.emit();
    expect(spy).toHaveBeenCalled();
  });
});
