import { AuthService } from '../../../core/auth.service';
import { CmsEditorPrefsService } from './cms-editor-prefs.service';

type UserLike = { id?: string } | null;

class AuthStub {
  private currentUser: UserLike = null;

  setUser(id: string | null): void {
    this.currentUser = id == null ? null : { id };
  }

  user(): UserLike {
    return this.currentUser;
  }
}

describe('CmsEditorPrefsService', () => {
  const keyFor = (userId: string | null): string => `admin.content.editorMode.v1:${(userId ?? '').trim() || 'anonymous'}`;

  beforeEach(() => {
    localStorage.clear();
  });

  it('loads persisted valid values for the active user and ignores invalid entries', () => {
    const auth = new AuthStub();
    auth.setUser('  user-1  ');
    localStorage.setItem(
      keyFor('user-1'),
      JSON.stringify({
        mode: 'advanced',
        previewDevice: 'tablet',
        previewLayout: 'split',
        previewLang: 'ro',
        previewTheme: 'dark',
        translationLayout: 'sideBySide',
        unknown: 'value',
        invalidMode: 'expert',
      })
    );

    const service = new CmsEditorPrefsService(auth as unknown as AuthService);

    expect(service.mode()).toBe('advanced');
    expect(service.previewDevice()).toBe('tablet');
    expect(service.previewLayout()).toBe('split');
    expect(service.previewLang()).toBe('ro');
    expect(service.previewTheme()).toBe('dark');
    expect(service.translationLayout()).toBe('sideBySide');
  });

  it('falls back to defaults when storage is empty or malformed', () => {
    const auth = new AuthStub();
    auth.setUser(null);
    localStorage.setItem(keyFor(null), '{broken-json');

    const service = new CmsEditorPrefsService(auth as unknown as AuthService);

    expect(service.mode()).toBe('simple');
    expect(service.previewDevice()).toBe('desktop');
    expect(service.previewLayout()).toBe('stacked');
    expect(service.previewLang()).toBe('en');
    expect(service.previewTheme()).toBe('light');
    expect(service.translationLayout()).toBe('single');
  });

  it('persists each setter and toggle with anonymous key when user id is absent', () => {
    const auth = new AuthStub();
    auth.setUser('   ');
    const setItemSpy = spyOn(localStorage, 'setItem').and.callThrough();
    const service = new CmsEditorPrefsService(auth as unknown as AuthService);

    service.setMode('advanced');
    service.setPreviewDevice('mobile');
    service.setPreviewLayout('split');
    service.setPreviewLang('ro');
    service.setPreviewTheme('dark');
    service.setTranslationLayout('sideBySide');
    service.toggleMode();

    expect(service.mode()).toBe('simple');
    expect(service.previewDevice()).toBe('mobile');
    expect(service.previewLayout()).toBe('split');
    expect(service.previewLang()).toBe('ro');
    expect(service.previewTheme()).toBe('dark');
    expect(service.translationLayout()).toBe('sideBySide');

    expect(setItemSpy).toHaveBeenCalled();
    const payload = JSON.parse(localStorage.getItem(keyFor(null)) ?? '{}') as Record<string, string>;
    expect(payload['mode']).toBe('simple');
    expect(payload['previewDevice']).toBe('mobile');
    expect(payload['previewLayout']).toBe('split');
    expect(payload['previewLang']).toBe('ro');
    expect(payload['previewTheme']).toBe('dark');
    expect(payload['translationLayout']).toBe('sideBySide');
  });

  it('swallows localStorage write errors', () => {
    const auth = new AuthStub();
    auth.setUser('user-write-error');
    const setItemSpy = spyOn(localStorage, 'setItem').and.throwError('write blocked');
    const service = new CmsEditorPrefsService(auth as unknown as AuthService);

    expect(() => service.setMode('advanced')).not.toThrow();
    expect(setItemSpy).toHaveBeenCalled();
  });
});
