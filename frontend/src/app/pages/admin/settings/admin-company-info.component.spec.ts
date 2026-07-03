import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AdminCompanyInfoComponent } from './admin-company-info.component';
import { AdminService } from '../../../core/admin.service';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Behavioural spec for the extracted Settings > Company info panel. Mirrors the
 * scenarios that previously lived against AdminComponent so behaviour and branch
 * coverage move with the code.
 */

const filled = {
  name: 'N',
  registration_number: 'R',
  cui: 'C',
  address: 'A',
  phone: 'P',
  email: 'E',
};

describe('AdminCompanyInfoComponent', () => {
  let fixture: ComponentFixture<AdminCompanyInfoComponent>;
  let c: AdminCompanyInfoComponent;
  let admin: jasmine.SpyObj<Pick<AdminService, 'getContent' | 'updateContentBlock' | 'createContent'>>;
  let remember: jasmine.Spy;
  let withExpected: jasmine.Spy;
  let conflict: jasmine.Spy;
  let forget: jasmine.Spy;

  beforeEach(async () => {
    admin = jasmine.createSpyObj('AdminService', [
      'getContent',
      'updateContentBlock',
      'createContent',
    ]);
    admin.getContent.and.returnValue(of({ meta: {}, version: 1 } as any));
    admin.updateContentBlock.and.returnValue(of({ version: 1 } as any));
    admin.createContent.and.returnValue(of({ version: 1 } as any));

    await TestBed.configureTestingModule({
      imports: [AdminCompanyInfoComponent, TranslateModule.forRoot()],
      providers: [{ provide: AdminService, useValue: admin }],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminCompanyInfoComponent);
    c = fixture.componentInstance;
    remember = jasmine.createSpy('rememberContentVersion');
    withExpected = jasmine.createSpy('withExpectedVersion').and.callFake((_k: string, p: any) => p);
    conflict = jasmine.createSpy('handleContentConflict').and.returnValue(false);
    forget = jasmine.createSpy('forgetContentVersion');
    c.rememberContentVersion = remember;
    c.withExpectedVersion = withExpected as any;
    c.handleContentConflict = conflict as any;
    c.forgetContentVersion = forget;
  });

  it('creates and loads company info on init', () => {
    fixture.detectChanges();
    expect(c).toBeTruthy();
    expect(admin.getContent).toHaveBeenCalledWith('site.company');
    expect(remember).toHaveBeenCalledWith('site.company', jasmine.anything());
  });

  it('loadCompany maps the nested company meta and resets + forgets version on error', () => {
    admin.getContent.and.returnValue(
      of({ version: 2, meta: { company: { name: ' Acme ', cui: 'RO1', email: 'x@y.z' } } } as any),
    );
    c.loadCompany();
    expect(c.companyForm.name).toBe('Acme');
    expect(c.companyForm.cui).toBe('RO1');
    expect(c.companyForm.registration_number).toBe('');

    admin.getContent.and.returnValue(throwError(() => ({})));
    c.loadCompany();
    expect(forget).toHaveBeenCalledWith('site.company');
    expect(c.companyForm.name).toBe('');
  });

  it('companyMissingFields lists empty required fields', () => {
    c.companyForm = {
      name: '',
      registration_number: '',
      cui: '',
      address: '',
      phone: '',
      email: '',
    };
    expect(c.companyMissingFields().length).toBe(6);
    c.companyForm = { ...filled };
    expect(c.companyMissingFields().length).toBe(0);
  });

  it('saveCompany blocks when required fields are missing', () => {
    c.companyForm = { ...filled, name: '' };
    c.saveCompany();
    expect(c.companyError).toBe('adminUi.site.company.errors.required');
    expect(admin.updateContentBlock).not.toHaveBeenCalled();
  });

  it('saveCompany persists, then handles conflict and 404 create paths', () => {
    c.companyForm = { ...filled };
    admin.updateContentBlock.and.returnValue(of({ version: 2 } as any));
    c.saveCompany();
    expect(withExpected).toHaveBeenCalledWith('site.company', jasmine.anything());
    expect(remember).toHaveBeenCalledWith('site.company', jasmine.objectContaining({ version: 2 }));
    expect(c.companyMessage).toBe('adminUi.site.company.success.save');

    // conflict path: handleContentConflict returns true -> save error, no create
    conflict.and.returnValue(true);
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.companyForm = { ...filled };
    c.saveCompany();
    expect(conflict).toHaveBeenCalled();
    expect(c.companyError).toBe('adminUi.site.company.errors.save');
    expect(c.companyMessage).toBeNull();

    // non-conflict error -> createContent fallback succeeds
    conflict.and.returnValue(false);
    c.companyForm = { ...filled };
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
    admin.createContent.and.returnValue(of({ version: 3 } as any));
    c.saveCompany();
    expect(admin.createContent).toHaveBeenCalledWith('site.company', jasmine.anything());
    expect(c.companyMessage).toBe('adminUi.site.company.success.save');

    // createContent also fails -> save error
    c.companyForm = { ...filled };
    admin.createContent.and.returnValue(throwError(() => ({})));
    c.saveCompany();
    expect(c.companyError).toBe('adminUi.site.company.errors.save');
    expect(c.companyMessage).toBeNull();
  });
});
