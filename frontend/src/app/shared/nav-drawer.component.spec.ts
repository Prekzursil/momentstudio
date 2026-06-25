import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';

import { NavDrawerComponent, NavLink, NavDrawerUser } from './nav-drawer.component';

describe('NavDrawerComponent', () => {
  let fixture: ComponentFixture<NavDrawerComponent>;
  let cmp: NavDrawerComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), NavDrawerComponent],
    });
    fixture = TestBed.createComponent(NavDrawerComponent);
    cmp = fixture.componentInstance;
  });

  function html(): string {
    return fixture.nativeElement.innerHTML as string;
  }

  it('creates and is closed by default', () => {
    fixture.detectChanges();
    expect(cmp).toBeTruthy();
    const aside = fixture.nativeElement.querySelector('aside') as HTMLElement;
    expect(aside.getAttribute('aria-hidden')).toBe('true');
    expect(aside.getAttribute('role')).toBeNull();
  });

  it('exposes dialog semantics when open', () => {
    cmp.open = true;
    fixture.detectChanges();
    const aside = fixture.nativeElement.querySelector('aside') as HTMLElement;
    expect(aside.getAttribute('role')).toBe('dialog');
    expect(aside.getAttribute('aria-modal')).toBe('true');
  });

  it('renders internal and external nav links', () => {
    const links: NavLink[] = [
      { label: 'Home', path: '/home' },
      { label: 'External', path: 'https://x.io', external: true },
      { label: 'Raw', path: '/raw', translate: false },
    ];
    cmp.links = links;
    fixture.detectChanges();
    const anchors = Array.from(
      fixture.nativeElement.querySelectorAll('nav a'),
    ) as HTMLAnchorElement[];
    expect(anchors.length).toBe(3);
    const external = anchors.find((a) => a.getAttribute('target') === '_blank');
    expect(external).toBeTruthy();
    expect(external?.getAttribute('rel')).toContain('noopener');
  });

  it('shows user block with avatar and display name when a user is set', () => {
    const user: NavDrawerUser = {
      email: 'a@b.com',
      username: 'alice',
      name: 'Alice',
      avatar_url: 'https://img/a.png',
    };
    cmp.user = user;
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://img/a.png');
    expect(html()).toContain('a@b.com');
  });

  it('hides the user block when there is no user', () => {
    cmp.user = null;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
  });

  it('hides the sign-out button when not authenticated', () => {
    cmp.isAuthenticated = false;
    fixture.detectChanges();
    expect(html()).not.toContain('nav.signOut');
  });

  it('shows the sign-out button when authenticated', () => {
    const f = TestBed.createComponent(NavDrawerComponent);
    f.componentInstance.isAuthenticated = true;
    f.detectChanges();
    expect(f.nativeElement.innerHTML as string).toContain('nav.signOut');
  });

  it('avatarUrl falls back to null and avatarSrc to the placeholder', () => {
    expect(cmp.avatarUrl()).toBeNull();
    expect(cmp.avatarSrc()).toBe(cmp.placeholderAvatar);

    cmp.user = { email: 'a@b.com', username: 'a', avatar_url: null };
    expect(cmp.avatarUrl()).toBeNull();
    expect(cmp.avatarSrc()).toBe(cmp.placeholderAvatar);

    cmp.user = { email: 'a@b.com', username: 'a', avatar_url: 'https://img/a.png' };
    expect(cmp.avatarUrl()).toBe('https://img/a.png');
    expect(cmp.avatarSrc()).toBe('https://img/a.png');
  });

  it('emits output events', () => {
    const events: string[] = [];
    cmp.closed.subscribe(() => events.push('closed'));
    cmp.signOut.subscribe(() => events.push('signOut'));
    cmp.themeChange.subscribe((p) => events.push(`theme:${p}`));
    cmp.languageChange.subscribe((l) => events.push(`lang:${l}`));

    cmp.onClose();
    cmp.onSignOut(); // emits signOut then closed
    cmp.onThemeChange('dark');
    cmp.onLanguageChange('ro');

    expect(events).toEqual(['closed', 'signOut', 'closed', 'theme:dark', 'lang:ro']);
  });

  it('displayName uses the identity formatter', () => {
    cmp.user = { email: 'a@b.com', username: 'alice', name: 'Alice', name_tag: 7 };
    expect(typeof cmp.displayName()).toBe('string');
    cmp.user = null;
    expect(cmp.displayName()).toBe('');
  });
});
