import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { AppComponent } from './app.component';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AuthService } from './core/auth.service';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot(), AppComponent],
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
            logout: () => of(null)
          }
        }
      ]
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
