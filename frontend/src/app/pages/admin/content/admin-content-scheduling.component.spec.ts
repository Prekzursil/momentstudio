import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import {
  AdminService,
  ContentSchedulingItem,
  ContentSchedulingListResponse,
  PaginationMeta,
} from '../../../core/admin.service';
import { AdminContentSchedulingComponent } from './admin-content-scheduling.component';

const DAY_MS = 86_400_000;

function isoOffset(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function makeItem(overrides: Partial<ContentSchedulingItem>): ContentSchedulingItem {
  return {
    key: 'page.home',
    title: 'Home',
    status: 'published',
    published_at: null,
    published_until: null,
    updated_at: isoOffset(-1),
    ...overrides,
  };
}

function makeMeta(overrides: Partial<PaginationMeta> = {}): PaginationMeta {
  return {
    total_items: 1,
    total_pages: 1,
    page: 1,
    limit: 50,
    ...overrides,
  };
}

describe('AdminContentSchedulingComponent', () => {
  let admin: jasmine.SpyObj<AdminService>;

  function setup(initial?: ContentSchedulingListResponse | null): AdminContentSchedulingComponent {
    admin.contentScheduling.and.returnValue(of(initial ?? { items: [], meta: makeMeta() }));
    const fixture = TestBed.createComponent(AdminContentSchedulingComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(async () => {
    admin = jasmine.createSpyObj<AdminService>('AdminService', ['contentScheduling']);
    admin.contentScheduling.and.returnValue(of({ items: [], meta: makeMeta() }));

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminContentSchedulingComponent],
      providers: [{ provide: AdminService, useValue: admin }, provideRouter([])],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        adminUi: {
          actions: { refresh: 'Refresh', prev: 'Prev', next: 'Next' },
          content: {
            scheduling: {
              title: 'Scheduling',
              hint: 'Plan content',
              window: 'Window',
              window30: '30 days',
              window90: '90 days',
              window180: '180 days',
              empty: 'Nothing scheduled',
              publish: 'Publish',
              unpublish: 'Unpublish',
              kind: { page: 'Page', blog: 'Blog', global: 'Global' },
              errors: { load: 'Failed to load scheduling' },
            },
          },
        },
        notifications: { loading: 'Loading…' },
      },
      true,
    );
    translate.use('en');
  });

  it('loads on init and renders the empty state when there are no rows', () => {
    setup({ items: [], meta: makeMeta() });

    expect(admin.contentScheduling).toHaveBeenCalledTimes(1);
    const params = admin.contentScheduling.calls.mostRecent().args[0];
    expect(params?.window_days).toBe(90);
    expect(params?.page).toBe(1);
    expect(params?.limit).toBe(50);
    expect(typeof params?.window_start).toBe('string');
  });

  it('stores items and meta on a successful response and renders schedule rows', () => {
    const items: ContentSchedulingItem[] = [
      // publish + unpublish both upcoming (page)
      makeItem({
        key: 'page.home',
        title: 'Home',
        published_at: isoOffset(1),
        published_until: isoOffset(10),
      }),
      // publish upcoming, no unpublish (blog with slug)
      makeItem({
        key: 'blog.my-post',
        title: 'My Post',
        published_at: isoOffset(2),
        published_until: null,
      }),
      // no publish, unpublish upcoming (global, empty title -> falls back to key)
      makeItem({
        key: 'site.announcement',
        title: '',
        published_at: null,
        published_until: isoOffset(5),
      }),
      // both in the past / absent -> filtered out
      makeItem({ key: 'page.old', published_at: isoOffset(-10), published_until: null }),
      // not a relevant key -> filtered out
      makeItem({ key: 'random.key', published_at: isoOffset(1) }),
      // relevant key but not published -> filtered out
      makeItem({ key: 'page.draft', status: 'draft', published_at: isoOffset(1) }),
      // blog with empty slug -> editor link slug becomes ''
      makeItem({ key: 'blog.', title: 'Bare blog', published_at: isoOffset(3) }),
      // invalid publish date -> parseTs returns null -> filtered out
      makeItem({ key: 'page.bad', published_at: 'not-a-date', published_until: null }),
      // past publish + upcoming unpublish (continuing) -> included, publishPct null
      makeItem({
        key: 'page.continuing',
        published_at: isoOffset(-5),
        published_until: isoOffset(7),
      }),
      // future publish + past unpublish -> included via publish, width clamps to 0
      makeItem({
        key: 'page.weird',
        published_at: isoOffset(4),
        published_until: isoOffset(-2),
      }),
      // publish beyond the window -> filtered out
      makeItem({ key: 'page.far', published_at: isoOffset(200), published_until: null }),
      // unpublish beyond the window -> filtered out
      makeItem({ key: 'page.farunpub', published_at: null, published_until: isoOffset(200) }),
      // empty key -> not relevant -> filtered out
      makeItem({ key: '', published_at: isoOffset(1) }),
    ];
    const meta = makeMeta({ total_items: items.length, total_pages: 1, page: 1 });
    const component = setup({ items, meta });

    expect(component.items().length).toBe(items.length);
    expect(component.meta()).toEqual(meta);
    expect(component.loading()).toBeFalse();
    expect(component.error()).toBeNull();

    const rows = component.scheduleRows();
    const keys = rows.map((r) => r.key);
    expect(keys).toContain('page.home');
    expect(keys).toContain('blog.my-post');
    expect(keys).toContain('site.announcement');
    expect(keys).toContain('blog.');
    expect(keys).toContain('page.continuing');
    expect(keys).toContain('page.weird');
    expect(keys).not.toContain('page.old');
    expect(keys).not.toContain('random.key');
    expect(keys).not.toContain('page.draft');
    expect(keys).not.toContain('page.bad');
    expect(keys).not.toContain('page.far');
    expect(keys).not.toContain('page.farunpub');
    expect(keys).not.toContain('');

    const home = rows.find((r) => r.key === 'page.home')!;
    expect(home.kind).toBe('page');
    expect(home.title).toBe('Home');
    expect(home.publishAt).not.toBeNull();
    expect(home.unpublishAt).not.toBeNull();
    expect(home.publishPct).not.toBeNull();
    expect(home.unpublishPct).not.toBeNull();
    expect(home.editorLink).toEqual({
      path: '/admin/content/pages',
      queryParams: { edit: 'page.home' },
    });

    const blog = rows.find((r) => r.key === 'blog.my-post')!;
    expect(blog.kind).toBe('blog');
    expect(blog.unpublishAt).toBeNull();
    expect(blog.unpublishPct).toBeNull();
    expect(blog.editorLink).toEqual({
      path: '/admin/content/blog',
      queryParams: { edit: 'my-post' },
    });

    const global = rows.find((r) => r.key === 'site.announcement')!;
    expect(global.kind).toBe('global');
    expect(global.title).toBe('site.announcement');
    expect(global.publishAt).toBeNull();
    expect(global.publishPct).toBeNull();
    expect(global.editorLink.path).toBe('/admin/content/pages');

    const bareBlog = rows.find((r) => r.key === 'blog.')!;
    expect(bareBlog.kind).toBe('blog');
    expect(bareBlog.editorLink).toEqual({
      path: '/admin/content/blog',
      queryParams: { edit: '' },
    });

    const continuing = rows.find((r) => r.key === 'page.continuing')!;
    expect(continuing.publishPct).toBeNull();
    expect(continuing.unpublishPct).not.toBeNull();
    expect(continuing.leftPct).toBe(0);

    const weird = rows.find((r) => r.key === 'page.weird')!;
    expect(weird.widthPct).toBe(0);
    expect(weird.unpublishPct).toBeNull();
    expect(weird.unpublishAt).not.toBeNull();

    // rows are sorted ascending by their next relevant timestamp
    const sortedTimestamps = rows.map((r) =>
      Math.min(
        r.publishAt && r.publishAt.getTime() >= Date.now()
          ? r.publishAt.getTime()
          : Number.POSITIVE_INFINITY,
        r.unpublishAt && r.unpublishAt.getTime() >= Date.now()
          ? r.unpublishAt.getTime()
          : Number.POSITIVE_INFINITY,
      ),
    );
    const ascending = [...sortedTimestamps].sort((a, b) => a - b);
    expect(sortedTimestamps).toEqual(ascending);
  });

  it('returns an empty array from scheduleRows when there are no items', () => {
    const component = setup({ items: [], meta: makeMeta() });
    expect(component.scheduleRows()).toEqual([]);
  });

  it('skips relevant items whose status is empty', () => {
    const component = setup({
      items: [
        makeItem({ key: 'page.empty-status', status: '', published_at: isoOffset(1) }),
        makeItem({ key: 'page.ok', status: 'published', published_at: isoOffset(2) }),
      ],
      meta: makeMeta({ total_items: 2 }),
    });

    const keys = component.scheduleRows().map((r) => r.key);
    expect(keys).toEqual(['page.ok']);
  });

  it('guards against a zero-length window when computing bar positions', () => {
    const component = setup({
      items: [makeItem({ key: 'page.home', published_at: isoOffset(1) })],
      meta: makeMeta(),
    });
    // A zero-day window collapses the timeline; the component must not divide by zero.
    component.windowDays.set(0);

    expect(() => component.scheduleRows()).not.toThrow();
    // Window end equals window start, so nothing falls inside the (empty) window.
    expect(component.scheduleRows()).toEqual([]);
  });

  it('treats a null response payload as empty items and meta', () => {
    admin.contentScheduling.and.returnValue(of(null as unknown as ContentSchedulingListResponse));
    const fixture = TestBed.createComponent(AdminContentSchedulingComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.items()).toEqual([]);
    expect(component.meta()).toBeNull();
    expect(component.loading()).toBeFalse();
  });

  it('sets a translated error message and clears loading when the request fails', () => {
    admin.contentScheduling.and.returnValue(throwError(() => new Error('boom')));
    const fixture = TestBed.createComponent(AdminContentSchedulingComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.error()).toBe('Failed to load scheduling');
    expect(component.loading()).toBeFalse();
  });

  it('updates the window for valid numeric values and reloads', () => {
    const component = setup({ items: [], meta: makeMeta() });
    admin.contentScheduling.calls.reset();

    component.setWindowDays(30);
    expect(component.windowDays()).toBe(30);
    expect(component.page()).toBe(1);
    expect(admin.contentScheduling).toHaveBeenCalledTimes(1);

    component.setWindowDays(180);
    expect(component.windowDays()).toBe(180);
  });

  it('coerces string window values and falls back to 90 for unsupported values', () => {
    const component = setup({ items: [], meta: makeMeta() });

    component.setWindowDays('180' as unknown as number);
    expect(component.windowDays()).toBe(180);

    component.setWindowDays(500);
    expect(component.windowDays()).toBe(90);
  });

  it('paginates forward and backward only within bounds', () => {
    const component = setup({ items: [], meta: makeMeta({ total_pages: 3, page: 1 }) });
    admin.contentScheduling.calls.reset();

    // already on the first page -> prevPage is a no-op
    component.prevPage();
    expect(component.page()).toBe(1);
    expect(admin.contentScheduling).not.toHaveBeenCalled();

    component.nextPage();
    expect(component.page()).toBe(2);
    expect(admin.contentScheduling).toHaveBeenCalledTimes(1);

    component.prevPage();
    expect(component.page()).toBe(1);
    expect(admin.contentScheduling).toHaveBeenCalledTimes(2);
  });

  it('does not advance past the last page', () => {
    const component = setup({ items: [], meta: makeMeta({ total_pages: 1, page: 1 }) });
    admin.contentScheduling.calls.reset();

    component.nextPage();
    expect(component.page()).toBe(1);
    expect(admin.contentScheduling).not.toHaveBeenCalled();
  });

  it('treats a missing meta as a single page when advancing', () => {
    const component = setup({ items: [], meta: makeMeta() });
    component.meta.set(null);
    admin.contentScheduling.calls.reset();

    component.nextPage();
    expect(component.page()).toBe(1);
    expect(admin.contentScheduling).not.toHaveBeenCalled();
  });

  it('computes calendar start and end dates from the window', () => {
    const component = setup({ items: [], meta: makeMeta() });

    const start = component.calendarStartDate();
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);

    const end = component.calendarEndDate();
    expect(end.getTime() - start.getTime()).toBe(90 * DAY_MS);

    component.setWindowDays(30);
    expect(component.calendarEndDate().getTime() - component.calendarStartDate().getTime()).toBe(
      30 * DAY_MS,
    );
  });

  it('maps each kind to its badge class', () => {
    const component = setup({ items: [], meta: makeMeta() });

    expect(component.kindBadgeClass('blog')).toContain('indigo');
    expect(component.kindBadgeClass('global')).toContain('amber');
    expect(component.kindBadgeClass('page')).toContain('slate');
  });

  it('tracks rows by their key', () => {
    const component = setup({ items: [], meta: makeMeta() });
    const row = component.scheduleRows()[0];
    expect(component.trackRow(0, { key: 'page.x' } as never)).toBe('page.x');
    expect(row).toBeUndefined();
  });

  it('renders error and pagination controls in the template', () => {
    const items = [
      makeItem({ key: 'page.home', published_at: isoOffset(1), published_until: isoOffset(5) }),
    ];
    const fixture = TestBed.createComponent(AdminContentSchedulingComponent);
    admin.contentScheduling.and.returnValue(
      of({ items, meta: makeMeta({ total_pages: 2, total_items: 1, page: 1 }) }),
    );
    fixture.detectChanges();

    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Scheduling');
    expect(text).toContain('Home');

    const buttons = fixture.debugElement.queryAll(By.css('app-button'));
    expect(buttons.length).toBeGreaterThan(0);
  });
});
