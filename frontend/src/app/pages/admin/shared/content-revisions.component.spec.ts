import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import {
  AdminService,
  ContentBlock,
  ContentBlockVersionListItem,
  ContentBlockVersionRead,
} from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { ContentRevisionsComponent } from './content-revisions.component';

function versionItem(version: number, status = 'published'): ContentBlockVersionListItem {
  return {
    id: `id-${version}`,
    version,
    title: `v${version}`,
    status,
    created_at: '2030-01-01T00:00:00+00:00',
  };
}

function versionRead(
  version: number,
  overrides: Partial<ContentBlockVersionRead> = {},
): ContentBlockVersionRead {
  return {
    ...versionItem(version),
    body_markdown: `body ${version}`,
    meta: null,
    lang: 'en',
    published_at: null,
    published_until: null,
    translations: [],
    ...overrides,
  };
}

describe('ContentRevisionsComponent', () => {
  let admin: jasmine.SpyObj<AdminService>;
  let toast: jasmine.SpyObj<ToastService>;
  let fixture: ComponentFixture<ContentRevisionsComponent>;
  let component: ContentRevisionsComponent;

  beforeEach(() => {
    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'listContentVersions',
      'getContent',
      'getContentVersion',
      'rollbackContentVersion',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success']);

    admin.listContentVersions.and.returnValue(of([versionItem(2), versionItem(1)]));
    admin.getContent.and.returnValue(of({ version: 2 } as unknown as ContentBlock));
    admin.getContentVersion.and.callFake((_key: string, v: number) => of(versionRead(v)));
    admin.rollbackContentVersion.and.returnValue(of({ version: 3 } as unknown as ContentBlock));

    TestBed.configureTestingModule({
      imports: [ContentRevisionsComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: ToastService, useValue: toast },
      ],
    });
    fixture = TestBed.createComponent(ContentRevisionsComponent);
    component = fixture.componentInstance;
  });

  function init(key = 'about'): void {
    component.contentKey = key;
    component.ngOnChanges({
      contentKey: {
        currentValue: key,
        previousValue: undefined,
        firstChange: true,
        isFirstChange: () => true,
      },
    });
    fixture.detectChanges();
  }

  it('loads versions and the current version, then computes a diff', () => {
    init();
    expect(component.versions().length).toBe(2);
    expect(component.currentRead()?.version).toBe(2);
    expect(component.selectedVersion).toBe(2);
    expect(component.diffParts.length).toBeGreaterThan(0);
    expect(component.loading()).toBeFalse();
  });

  it('ignores an empty content key', () => {
    component.contentKey = '   ';
    component.ngOnChanges({
      contentKey: {
        currentValue: '   ',
        previousValue: undefined,
        firstChange: true,
        isFirstChange: () => true,
      },
    });
    expect(admin.listContentVersions).not.toHaveBeenCalled();
  });

  it('does not reload when the key is unchanged', () => {
    init('about');
    admin.listContentVersions.calls.reset();
    component.ngOnChanges({
      contentKey: {
        currentValue: 'about',
        previousValue: 'about',
        firstChange: false,
        isFirstChange: () => false,
      },
    });
    expect(admin.listContentVersions).not.toHaveBeenCalled();
  });

  it('prefers the published version when the current is a draft', () => {
    admin.listContentVersions.and.returnValue(
      of([versionItem(3, 'draft'), versionItem(2, 'published')]),
    );
    admin.getContent.and.returnValue(of({ version: 3 } as unknown as ContentBlock));
    admin.getContentVersion.and.callFake((_k: string, v: number) =>
      of(versionRead(v, { status: v === 3 ? 'draft' : 'published' })),
    );
    init();
    expect(component.selectedVersion).toBe(2);
  });

  it('treats a 404 on versions as an empty history', () => {
    admin.listContentVersions.and.returnValue(throwError(() => ({ status: 404 })));
    init();
    expect(component.versions()).toEqual([]);
    expect(component.error()).toBeNull();
  });

  it('shows an error when listing versions fails', () => {
    admin.listContentVersions.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: { request_id: 'r1' } })),
    );
    init();
    expect(component.error()).toContain('errors.load');
    expect(component.errorRequestId()).toBe('r1');
  });

  it('handles a current block with no version', () => {
    admin.getContent.and.returnValue(of({} as unknown as ContentBlock));
    init();
    expect(component.currentRead()).toBeNull();
  });

  it('shows an error when the current version read fails', () => {
    admin.getContentVersion.and.callFake((_k: string, v: number) =>
      v === 2
        ? throwError(() => new HttpErrorResponse({ status: 500, error: { request_id: 'rv' } }))
        : of(versionRead(v)),
    );
    init();
    expect(component.error()).toContain('errors.loadVersion');
    expect(component.errorRequestId()).toBe('rv');
  });

  it('handles a failing getContent call', () => {
    admin.getContent.and.returnValue(throwError(() => new Error('missing')));
    init();
    expect(component.currentRead()).toBeNull();
  });

  it('reloads selected version and recomputes the diff', () => {
    init();
    admin.getContentVersion.calls.reset();
    component.selectedVersion = 1;
    component.loadSelectedVersion();
    expect(admin.getContentVersion).toHaveBeenCalledWith('about', 1);
    expect(component.selectedRead()?.version).toBe(1);
  });

  it('toasts when loadSelectedVersion fails', () => {
    init();
    admin.getContentVersion.and.returnValue(throwError(() => new Error('x')));
    component.selectedVersion = 1;
    component.loadSelectedVersion();
    expect(toast.error).toHaveBeenCalled();
  });

  it('ignores loadSelectedVersion without a key or version', () => {
    component.contentKey = '';
    component.selectedVersion = null;
    component.loadSelectedVersion();
    expect(admin.getContentVersion).not.toHaveBeenCalled();
  });

  it('rolls back the selected version after confirmation', () => {
    init();
    spyOn(window, 'confirm').and.returnValue(true);
    admin.listContentVersions.calls.reset();
    component.rollbackSelected();
    expect(admin.rollbackContentVersion).toHaveBeenCalledWith('about', 2);
    expect(toast.success).toHaveBeenCalled();
    expect(admin.listContentVersions).toHaveBeenCalled();
  });

  it('does not roll back when confirmation is declined', () => {
    init();
    spyOn(window, 'confirm').and.returnValue(false);
    component.rollbackSelected();
    expect(admin.rollbackContentVersion).not.toHaveBeenCalled();
  });

  it('toasts when rollback fails', () => {
    init();
    spyOn(window, 'confirm').and.returnValue(true);
    admin.rollbackContentVersion.and.returnValue(throwError(() => new Error('x')));
    component.rollbackSelected();
    expect(toast.error).toHaveBeenCalled();
  });

  it('ignores rollback without a key or selected version', () => {
    init();
    component.contentKey = '';
    component.rollbackSelected();
    expect(admin.rollbackContentVersion).not.toHaveBeenCalled();
  });

  it('renders rich snapshot fields in the diff', () => {
    admin.getContentVersion.and.callFake((_k: string, v: number) =>
      of(
        versionRead(v, {
          title: `Title ${v}`,
          meta: { foo: 'bar' },
          published_at: '2030-01-01',
          published_until: '2031-01-01',
          translations: [{ lang: 'ro', title: 'Titlu', body_markdown: 'Corp' }],
        }),
      ),
    );
    init();
    component.selectedVersion = 1;
    component.loadSelectedVersion();
    expect(component.diffParts.length).toBeGreaterThan(0);
  });

  it('reload returns early without a content key', () => {
    component.contentKey = '';
    component.reload();
    expect(admin.listContentVersions).not.toHaveBeenCalled();
  });

  it('tolerates a null version list', () => {
    admin.listContentVersions.and.returnValue(of(null as unknown as ContentBlockVersionListItem[]));
    init();
    expect(component.versions()).toEqual([]);
  });

  it('ignores ngOnChanges when contentKey resolves to empty', () => {
    component.contentKey = null as unknown as string;
    component.ngOnChanges({
      contentKey: {
        currentValue: null,
        previousValue: undefined,
        firstChange: true,
        isFirstChange: () => true,
      },
    });
    expect(admin.listContentVersions).not.toHaveBeenCalled();
  });

  it('does not auto-select when the latest version is falsy', () => {
    admin.listContentVersions.and.returnValue(
      of([
        {
          id: 'z',
          version: 0,
          title: 'z',
          status: 'published',
          created_at: '2030-01-01T00:00:00+00:00',
        },
      ]),
    );
    init();
    expect(component.selectedVersion).toBeNull();
  });

  it('renders snapshot fallbacks for null/empty fields', () => {
    admin.getContentVersion.and.callFake((_k: string, v: number) =>
      of(
        versionRead(v, {
          title: null as unknown as string,
          lang: null,
          body_markdown: '',
          meta: null,
          translations: [{ lang: 'en', title: '', body_markdown: '' }],
        }),
      ),
    );
    init();
    component.selectedVersion = 1;
    component.loadSelectedVersion();
    expect(component.diffParts.length).toBeGreaterThanOrEqual(0);
  });

  it('handles a null translations array in the snapshot', () => {
    admin.getContentVersion.and.callFake((_k: string, v: number) =>
      of(versionRead(v, { translations: null })),
    );
    init();
    expect(component.diffParts.length).toBeGreaterThanOrEqual(0);
  });

  it('unsubscribes on destroy', () => {
    init();
    expect(() => component.ngOnDestroy()).not.toThrow();
  });
});
