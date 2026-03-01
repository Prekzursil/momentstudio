import { of, throwError } from 'rxjs';

import { ContentRevisionsComponent } from './content-revisions.component';

type AdminSpy = jasmine.SpyObj<any>;

describe('ContentRevisionsComponent', () => {
  function createComponent(): {
    component: ContentRevisionsComponent;
    admin: AdminSpy;
    toast: jasmine.SpyObj<any>;
  } {
    const admin = jasmine.createSpyObj('AdminService', [
      'listContentVersions',
      'getContent',
      'getContentVersion',
      'rollbackContentVersion'
    ]);
    const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    const translate = { instant: (key: string) => key };
    const component = new ContentRevisionsComponent(admin as any, toast as any, translate as any);
    component.contentKey = 'site.block';
    return { component, admin, toast };
  }

  it('reloads when content key changes and ignores empty key', () => {
    const { component } = createComponent();
    const reloadSpy = spyOn(component, 'reload');

    component.contentKey = '  ';
    component.ngOnChanges({ contentKey: { currentValue: '  ', previousValue: '', firstChange: false, isFirstChange: () => false } as any });
    expect(reloadSpy).not.toHaveBeenCalled();

    component.contentKey = 'site.home';
    component.ngOnChanges({ contentKey: { currentValue: 'site.home', previousValue: '', firstChange: false, isFirstChange: () => false } as any });
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    component.ngOnChanges({ contentKey: { currentValue: 'site.home', previousValue: 'site.home', firstChange: false, isFirstChange: () => false } as any });
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('loads revisions, current version, and computes diff', () => {
    const { component, admin } = createComponent();
    admin.listContentVersions.and.returnValue(
      of([
        { version: 3, status: 'draft', created_at: '2026-02-27T10:00:00Z' },
        { version: 2, status: 'published', created_at: '2026-02-26T10:00:00Z' }
      ])
    );
    admin.getContent.and.returnValue(of({ version: 3 }));
    admin.getContentVersion.and.callFake((_key: string, version: number) =>
      of({
        version,
        title: version === 3 ? 'Current' : 'Published',
        status: version === 3 ? 'draft' : 'published',
        body_markdown: version === 3 ? 'current body' : 'published body',
        lang: 'en',
        meta: { version },
        translations: [{ lang: 'en', title: 'Title', body_markdown: 'Body' }]
      })
    );

    component.reload();

    expect(component.loading()).toBeFalse();
    expect(component.versions().length).toBe(2);
    expect(component.selectedVersion).toBe(2);
    expect(component.currentRead()?.version).toBe(3);
    expect(component.selectedRead()?.version).toBe(2);
    expect(component.diffParts.length).toBeGreaterThan(0);
  });

  it('handles load errors and selected-version errors', () => {
    const { component, admin, toast } = createComponent();
    admin.listContentVersions.and.returnValue(throwError(() => ({ status: 500, error: { request_id: 'req-1' } })));
    admin.getContent.and.returnValue(throwError(() => ({ status: 404 })));

    component.reload();

    expect(component.error()).toBe('adminUi.content.revisions.errors.load');

    admin.getContentVersion.and.returnValue(throwError(() => ({ status: 500 })));
    component.selectedVersion = 9;
    component.loadSelectedVersion();
    expect(toast.error).toHaveBeenCalledWith('adminUi.content.revisions.errors.loadVersion');
  });

  it('rolls back selected version on confirm and handles failure', () => {
    const { component, admin, toast } = createComponent();
    component.selectedRead.set({ version: 7 } as any);
    component.contentKey = 'site.block';
    const reloadSpy = spyOn(component, 'reload');

    const confirmSpy = spyOn(window, 'confirm');
    confirmSpy.and.returnValue(false);
    component.rollbackSelected();
    expect(admin.rollbackContentVersion).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    admin.rollbackContentVersion.and.returnValue(of({ ok: true }));
    component.rollbackSelected();
    expect(admin.rollbackContentVersion).toHaveBeenCalledWith('site.block', 7);
    expect(toast.success).toHaveBeenCalledWith('adminUi.content.revisions.success.rolledBack');
    expect(reloadSpy).toHaveBeenCalled();

    admin.rollbackContentVersion.and.returnValue(throwError(() => ({ status: 500 })));
    component.rollbackSelected();
    expect(toast.error).toHaveBeenCalledWith('adminUi.content.revisions.errors.rollback');
  });

  it('cleans subscriptions on destroy', () => {
    const { component } = createComponent();
    const sub = (component as any).subs;
    const unsubscribeSpy = spyOn(sub, 'unsubscribe');

    component.ngOnDestroy();

    expect(unsubscribeSpy).toHaveBeenCalled();
  });
});
