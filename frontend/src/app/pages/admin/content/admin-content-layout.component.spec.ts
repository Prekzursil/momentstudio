import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../../core/auth.service';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { FormSectionComponent } from '../../../shared/form-section.component';
import { CmsEditorPrefsService } from '../shared/cms-editor-prefs.service';
import { AdminContentLayoutComponent } from './admin-content-layout.component';

@Component({
  selector: 'app-page-header',
  standalone: true,
  template: '',
})
class PageHeaderStubComponent {
  @Input() title = '';
  @Input() titleKey = '';
  @Input() subtitle = '';
  @Input() subtitleKey = '';
  @Input() crumbs: unknown[] = [];
}

@Component({
  selector: 'app-form-section',
  standalone: true,
  template: '<ng-content></ng-content>',
})
class FormSectionStubComponent {
  @Input() title = '';
  @Input() titleKey = '';
  @Input() description = '';
  @Input() descriptionKey = '';
}

describe('AdminContentLayoutComponent', () => {
  let fixture: ComponentFixture<AdminContentLayoutComponent>;
  let component: AdminContentLayoutComponent;
  let prefs: CmsEditorPrefsService;

  beforeEach(async () => {
    // Minimal AuthService: the prefs service only reads auth.user() to build a
    // per-user storage key. An anonymous user keeps the test self-contained.
    const auth = { user: () => null } as unknown as AuthService;

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AdminContentLayoutComponent],
      providers: [{ provide: AuthService, useValue: auth }],
    })
      .overrideComponent(AdminContentLayoutComponent, {
        remove: { imports: [PageHeaderComponent, FormSectionComponent] },
        add: { imports: [PageHeaderStubComponent, FormSectionStubComponent] },
      })
      .compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        theme: { light: 'Light', dark: 'Dark' },
        adminUi: {
          content: {
            title: 'Content',
            subtitle: 'Manage site content',
            workspace: { title: 'Workspace', hint: 'Pick a section' },
            editorMode: {
              label: 'Editor mode',
              simple: 'Simple',
              advanced: 'Advanced',
              simpleHint: 'Simple editing experience',
              advancedHint: 'Advanced editing experience',
            },
            preview: {
              deviceLabel: 'Device',
              desktop: 'Desktop',
              tablet: 'Tablet',
              mobile: 'Mobile',
              layoutLabel: 'Layout',
              stacked: 'Stacked',
              split: 'Split',
              languageLabel: 'Language',
              themeLabel: 'Theme',
            },
            nav: {
              home: 'Home',
              pages: 'Pages',
              blog: 'Blog',
              scheduling: 'Scheduling',
              media: 'Media',
              settings: 'Settings',
            },
          },
        },
      },
      true,
    );
    translate.use('en');

    fixture = TestBed.createComponent(AdminContentLayoutComponent);
    component = fixture.componentInstance;
    prefs = TestBed.inject(CmsEditorPrefsService);
    fixture.detectChanges();
  });

  function buttonByText(label: string): HTMLButtonElement {
    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (el) => ((el as HTMLElement).textContent || '').trim() === label,
    ) as HTMLButtonElement | undefined;
    if (!button) {
      throw new Error(`Button with label "${label}" not found`);
    }
    return button;
  }

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('exposes static breadcrumbs ending at the content title', () => {
    expect(component.crumbs).toEqual([
      { label: 'nav.home', url: '/' },
      { label: 'nav.admin', url: '/admin/dashboard' },
      { label: 'adminUi.content.title' },
    ]);
    const header = fixture.debugElement.query(By.directive(PageHeaderStubComponent));
    expect(header.componentInstance.crumbs).toBe(component.crumbs);
    expect(header.componentInstance.titleKey).toBe('adminUi.content.title');
    expect(header.componentInstance.subtitleKey).toBe('adminUi.content.subtitle');
  });

  it('renders one navigation link per content section with translated labels and routerLinks', () => {
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('nav a'),
    ) as HTMLAnchorElement[];
    expect(links.length).toBe(component.nav.length);

    const expectedPaths = [
      '/admin/content/home',
      '/admin/content/pages',
      '/admin/content/blog',
      '/admin/content/scheduling',
      '/admin/content/media',
      '/admin/content/settings',
    ];
    expect(component.nav.map((item) => item.path)).toEqual(expectedPaths);

    expect(links.map((a) => (a.textContent || '').trim())).toEqual([
      'Home',
      'Pages',
      'Blog',
      'Scheduling',
      'Media',
      'Settings',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(expectedPaths);
  });

  it('projects the workspace into the form section with the correct keys', () => {
    const section = fixture.debugElement.query(By.directive(FormSectionStubComponent));
    expect(section.componentInstance.titleKey).toBe('adminUi.content.workspace.title');
    expect(section.componentInstance.descriptionKey).toBe('adminUi.content.workspace.hint');
    // Projected content is rendered through the section's ng-content slot.
    expect(section.nativeElement.querySelectorAll('nav a').length).toBe(component.nav.length);
  });

  it('renders the router outlet for child content routes', () => {
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeTruthy();
  });

  it('reflects the simple editor mode as the active button and shows the simple hint', () => {
    prefs.setMode('simple');
    fixture.detectChanges();

    const simple = buttonByText('Simple');
    const advanced = buttonByText('Advanced');
    expect(simple.classList).toContain('bg-slate-900');
    expect(simple.classList).toContain('text-white');
    expect(advanced.classList).toContain('text-slate-700');
    expect(advanced.classList).not.toContain('bg-slate-900');

    const hint = (fixture.nativeElement.querySelector('p')?.textContent || '').trim();
    expect(hint).toBe('Simple editing experience');
  });

  it('switches to advanced mode and shows the advanced hint when the advanced button is clicked', () => {
    const setMode = spyOn(prefs, 'setMode').and.callThrough();

    buttonByText('Advanced').click();
    fixture.detectChanges();

    expect(setMode).toHaveBeenCalledWith('advanced');
    expect(prefs.mode()).toBe('advanced');

    const advanced = buttonByText('Advanced');
    expect(advanced.classList).toContain('bg-slate-900');
    expect(advanced.classList).toContain('text-white');

    const hint = (fixture.nativeElement.querySelector('p')?.textContent || '').trim();
    expect(hint).toBe('Advanced editing experience');
  });

  it('updates the preview device when a device button is clicked', () => {
    const setDevice = spyOn(prefs, 'setPreviewDevice').and.callThrough();

    buttonByText('Tablet').click();
    fixture.detectChanges();
    expect(setDevice).toHaveBeenCalledWith('tablet');
    expect(prefs.previewDevice()).toBe('tablet');
    expect(buttonByText('Tablet').classList).toContain('bg-slate-900');

    buttonByText('Mobile').click();
    fixture.detectChanges();
    expect(setDevice).toHaveBeenCalledWith('mobile');
    expect(prefs.previewDevice()).toBe('mobile');
    expect(buttonByText('Desktop').classList).toContain('text-slate-700');
  });

  it('updates the preview layout when a layout button is clicked', () => {
    const setLayout = spyOn(prefs, 'setPreviewLayout').and.callThrough();

    buttonByText('Split').click();
    fixture.detectChanges();
    expect(setLayout).toHaveBeenCalledWith('split');
    expect(prefs.previewLayout()).toBe('split');
    expect(buttonByText('Split').classList).toContain('bg-slate-900');
    expect(buttonByText('Stacked').classList).toContain('text-slate-700');
  });

  it('updates the preview language when a language button is clicked', () => {
    const setLang = spyOn(prefs, 'setPreviewLang').and.callThrough();

    buttonByText('RO').click();
    fixture.detectChanges();
    expect(setLang).toHaveBeenCalledWith('ro');
    expect(prefs.previewLang()).toBe('ro');
    expect(buttonByText('RO').classList).toContain('bg-slate-900');
    expect(buttonByText('EN').classList).toContain('text-slate-700');

    buttonByText('EN').click();
    fixture.detectChanges();
    expect(setLang).toHaveBeenCalledWith('en');
    expect(prefs.previewLang()).toBe('en');
    expect(buttonByText('EN').classList).toContain('bg-slate-900');
  });

  it('updates the preview theme when a theme button is clicked', () => {
    const setTheme = spyOn(prefs, 'setPreviewTheme').and.callThrough();

    buttonByText('Dark').click();
    fixture.detectChanges();
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(prefs.previewTheme()).toBe('dark');
    expect(buttonByText('Dark').classList).toContain('bg-slate-900');
    expect(buttonByText('Light').classList).toContain('text-slate-700');
  });
});
