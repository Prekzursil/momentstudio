import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ButtonComponent } from '../../shared/button.component';
import { OfflineComponent } from './offline.component';

describe('OfflineComponent', () => {
  let fixture: ComponentFixture<OfflineComponent>;
  let component: OfflineComponent;
  let translate: TranslateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule, OfflineComponent, TranslateModule.forRoot()],
    });

    fixture = TestBed.createComponent(OfflineComponent);
    component = fixture.componentInstance;
    translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      pwa: {
        offlineBadge: 'Offline mode',
        offlineTitle: 'You are offline',
        offlineBody: 'Check your connection and try again.',
        retry: 'Retry',
        goHome: 'Go home',
      },
    });
    translate.use('en');
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders the offline status region with translated badge, title, and body', () => {
    const region = fixture.debugElement.query(By.css('[role="status"]'));
    expect(region).not.toBeNull();
    expect(region.attributes['aria-live']).toBe('polite');

    const badge = fixture.debugElement.query(By.css('p.uppercase'));
    expect(badge.nativeElement.textContent.trim()).toBe('Offline mode');

    const title = fixture.debugElement.query(By.css('h1'));
    expect(title.nativeElement.textContent.trim()).toBe('You are offline');

    const body = fixture.debugElement.query(By.css('p.text-slate-600'));
    expect(body.nativeElement.textContent.trim()).toBe('Check your connection and try again.');
  });

  it('renders four action buttons with the expected labels and router links', () => {
    const buttons = fixture.debugElement.queryAll(By.directive(ButtonComponent));
    expect(buttons.length).toBe(4);

    const instances = buttons.map((b) => b.componentInstance as ButtonComponent);
    expect(instances[0].label).toBe('Retry');
    expect(instances[0].routerLink).toBeUndefined();

    expect(instances[1].label).toBe('Go home');
    expect(instances[1].variant).toBe('ghost');
    expect(instances[1].routerLink).toBe('/');

    expect(instances[2].label).toBe('Browse shop');
    expect(instances[2].variant).toBe('ghost');
    expect(instances[2].routerLink).toBe('/shop');

    expect(instances[3].label).toBe('Read blog');
    expect(instances[3].variant).toBe('ghost');
    expect(instances[3].routerLink).toBe('/blog');
  });

  it('invokes onRetry when the retry button emits its action', () => {
    const retrySpy = spyOn(component, 'onRetry');
    const retryButton = fixture.debugElement.queryAll(By.directive(ButtonComponent))[0];

    (retryButton.componentInstance as ButtonComponent).action.emit();

    expect(retrySpy).toHaveBeenCalledTimes(1);
  });
});
