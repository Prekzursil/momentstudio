import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { AppComponent } from './app.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { AuthService } from './core/auth.service';
import { RouteRobotsService } from './core/route-robots.service';
import { ClarityService } from './core/clarity.service';
import { ThemeService } from './core/theme.service';
import { LanguageService } from './core/language.service';
import { ToastService } from './core/toast.service';
import { AnalyticsService } from './core/analytics.service';
import { RouteHeadingFocusService } from './core/route-heading-focus.service';
import { HttpErrorBusService } from './core/http-error-bus.service';

@Component({
  selector: 'app-header',
  standalone: true,
  template: '',
  inputs: ['themePreference', 'language'],
})
class StubHeaderComponent {}
@Component({ selector: 'app-footer', standalone: true, template: '' })
class StubFooterComponent {}
@Component({ selector: 'app-container', standalone: true, template: '<ng-content></ng-content>' })
class StubContainerComponent {}
@Component({
  selector: 'app-cms-global-section-blocks',
  standalone: true,
  template: '',
  inputs: ['contentKey', 'containerClasses', 'reserveLoadingHeightClass', 'loadingSkeletonCount'],
})
class StubCmsComponent {}
@Component({ selector: 'app-toast', standalone: true, template: '', inputs: ['messages'] })
class StubToastComponent {}

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule,
        HttpClientTestingModule,
        TranslateModule.forRoot(),
        AppComponent,
      ],
      providers: [
        {
          provide: AuthService,
          useValue: {
            user: () => null,
            isAuthenticated: () => false,
            isStaff: () => false,
            isAdmin: () => false,
            isImpersonating: () => false,
            ensureAuthenticated: () => of(false),
            loadCurrentUser: () => of(null),
            updatePreferredLanguage: () => of(null),
            checkAdminAccess: () => of(null),
            logout: () => of(null),
          },
        },
        {
          provide: RouteRobotsService,
          useValue: { start: () => void 0 },
        },
        {
          provide: ClarityService,
          useValue: { start: () => void 0 },
        },
      ],
    }).compileComponents();
  });

  it('should create the app shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders a semantic main landmark', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const main = fixture.nativeElement.querySelector('main#main-content');
    expect(main).toBeTruthy();
  });
});

describe('AppComponent behavior', () => {
  let queryParams: BehaviorSubject<Record<string, string>>;
  let errorBus: Subject<{ status: number; method: string; url: string }>;
  let theme: jasmine.SpyObj<ThemeService>;
  let lang: jasmine.SpyObj<LanguageService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    queryParams = new BehaviorSubject<Record<string, string>>({});
    errorBus = new Subject();
    theme = jasmine.createSpyObj<ThemeService>('ThemeService', [
      'preference',
      'mode',
      'setPreference',
    ]);
    theme.preference.and.returnValue(signal('system') as never);
    theme.mode.and.returnValue(signal('light') as never);
    lang = jasmine.createSpyObj<LanguageService>('LanguageService', ['setLanguage']);
    (lang as unknown as { language: unknown }).language = signal('en');
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['messages', 'success', 'error']);
    toast.messages.and.returnValue(signal([]) as never);

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AppComponent],
      providers: [
        { provide: ThemeService, useValue: theme },
        { provide: LanguageService, useValue: lang },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthService,
          useValue: { ensureAuthenticated: () => of(false) },
        },
        { provide: AnalyticsService, useValue: { startSession: () => void 0 } },
        { provide: ClarityService, useValue: { start: () => void 0 } },
        { provide: RouteRobotsService, useValue: { start: () => void 0 } },
        {
          provide: RouteHeadingFocusService,
          useValue: { focusCurrentRouteHeading: () => void 0 },
        },
        { provide: HttpErrorBusService, useValue: { events$: errorBus.asObservable() } },
        { provide: ActivatedRoute, useValue: { queryParams: queryParams.asObservable() } },
        {
          provide: TranslateService,
          useValue: { instant: (k: string) => k },
        },
      ],
    })
      .overrideComponent(AppComponent, {
        set: {
          imports: [
            RouterOutlet,
            StubHeaderComponent,
            StubFooterComponent,
            StubContainerComponent,
            StubCmsComponent,
            StubToastComponent,
          ],
        },
      })
      .compileComponents();
  });

  function create(): AppComponent {
    const fixture = TestBed.createComponent(AppComponent);
    return fixture.componentInstance;
  }

  it('applies valid lang and theme query params', () => {
    create();
    queryParams.next({ lang: 'RO', theme: 'Dark' });
    expect(lang.setLanguage).toHaveBeenCalledWith('ro', { persist: false, syncBackend: false });
    expect(theme.setPreference).toHaveBeenCalledWith('dark', false);
  });

  it('ignores invalid lang and theme query params', () => {
    create();
    lang.setLanguage.calls.reset();
    queryParams.next({ lang: 'fr', theme: 'neon' });
    expect(lang.setLanguage).not.toHaveBeenCalled();
  });

  it('ignores non-string query params', () => {
    create();
    lang.setLanguage.calls.reset();
    queryParams.next({} as Record<string, string>);
    expect(lang.setLanguage).not.toHaveBeenCalled();
  });

  it('onThemeChange persists and toasts', () => {
    const app = create();
    app.onThemeChange('dark');
    expect(theme.setPreference).toHaveBeenCalledWith('dark');
    expect(toast.success).toHaveBeenCalled();
  });

  it('onLanguageChange sets a valid language and ignores invalid', () => {
    const app = create();
    app.onLanguageChange('ro');
    expect(lang.setLanguage).toHaveBeenCalledWith('ro');
    lang.setLanguage.calls.reset();
    app.onLanguageChange('xx');
    expect(lang.setLanguage).not.toHaveBeenCalled();
  });

  it('surfaces network errors and throttles repeats', () => {
    create();
    errorBus.next({ status: 0, method: 'GET', url: '/a' });
    expect(toast.error).toHaveBeenCalledTimes(1);
    errorBus.next({ status: 0, method: 'GET', url: '/b' });
    expect(toast.error).toHaveBeenCalledTimes(1); // throttled
  });

  it('surfaces server errors and ignores 4xx', () => {
    create();
    errorBus.next({ status: 503, method: 'GET', url: '/a' });
    expect(toast.error).toHaveBeenCalledTimes(1);
    errorBus.next({ status: 500, method: 'GET', url: '/b' });
    expect(toast.error).toHaveBeenCalledTimes(1); // throttled
    errorBus.next({ status: 404, method: 'GET', url: '/c' });
    expect(toast.error).toHaveBeenCalledTimes(1); // 4xx not surfaced
  });

  it('handles a null error event status as network', () => {
    create();
    errorBus.next(null as never);
    expect(toast.error).toHaveBeenCalled();
  });

  it('unsubscribes on destroy', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(() => fixture.destroy()).not.toThrow();
  });
});

describe('AppComponent startup auth error path', () => {
  it('still starts clarity when session revalidation errors', async () => {
    const clarityStart = jasmine.createSpy('start');
    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AppComponent],
      providers: [
        {
          provide: AuthService,
          useValue: {
            user: () => null,
            isAuthenticated: () => false,
            ensureAuthenticated: () => throwError(() => new Error('no session')),
          },
        },
        {
          provide: ThemeService,
          useValue: {
            preference: () => signal('system'),
            mode: () => signal('light'),
            setPreference: () => void 0,
          },
        },
        {
          provide: LanguageService,
          useValue: { language: signal('en'), setLanguage: () => void 0 },
        },
        { provide: ToastService, useValue: { messages: () => signal([]) } },
        { provide: AnalyticsService, useValue: { startSession: () => void 0 } },
        { provide: ClarityService, useValue: { start: clarityStart } },
        { provide: RouteRobotsService, useValue: { start: () => void 0 } },
        {
          provide: RouteHeadingFocusService,
          useValue: { focusCurrentRouteHeading: () => void 0 },
        },
        { provide: HttpErrorBusService, useValue: { events$: new Subject().asObservable() } },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      ],
    })
      .overrideComponent(AppComponent, {
        set: {
          imports: [
            RouterOutlet,
            StubHeaderComponent,
            StubFooterComponent,
            StubContainerComponent,
            StubCmsComponent,
            StubToastComponent,
          ],
        },
      })
      .compileComponents();

    TestBed.createComponent(AppComponent);
    expect(clarityStart).toHaveBeenCalled();
  });
});
