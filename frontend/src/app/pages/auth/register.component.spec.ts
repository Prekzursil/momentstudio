import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AuthResponse, AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { RegisterComponent } from './register.component';

describe('RegisterComponent', () => {
  it('submits registration payload with derived E.164 phone', () => {
    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['register', 'startGoogleLogin']);
    const toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    const router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    router.navigateByUrl.and.returnValue(Promise.resolve(true));

    auth.register.and.returnValue(
      of({
        user: { email: 'ana@example.com', username: 'ana2005l', id: 'u1', role: 'user' },
        tokens: { access_token: 'a', refresh_token: 'r', token_type: 'bearer' }
      } as AuthResponse)
    );

    TestBed.configureTestingModule({
      imports: [RegisterComponent, RouterTestingModule, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router }
      ]
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { auth: { successRegister: 'Account created' } }, true);
    translate.use('en');

    const fixture = TestBed.createComponent(RegisterComponent);
    const cmp = fixture.componentInstance;
    cmp.displayName = 'Ana';
    cmp.username = 'ana2005l';
    cmp.email = 'ana@example.com';
    cmp.password = 'supersecret';
    cmp.confirmPassword = 'supersecret';
    cmp.firstName = 'Ana';
    cmp.middleName = '';
    cmp.lastName = 'Test';
    cmp.dateOfBirth = '2000-01-01';
    cmp.phoneCountry = 'RO';
    cmp.phoneNational = '723204204';

    cmp.onSubmit({ valid: true } as any);

    expect(auth.register).toHaveBeenCalledWith({
      name: 'Ana',
      username: 'ana2005l',
      email: 'ana@example.com',
      password: 'supersecret',
      first_name: 'Ana',
      middle_name: null,
      last_name: 'Test',
      date_of_birth: '2000-01-01',
      phone: '+40723204204'
    });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
    expect(toast.success).toHaveBeenCalled();
  });
});

