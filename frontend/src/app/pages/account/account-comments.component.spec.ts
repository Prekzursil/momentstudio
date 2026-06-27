import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { BlogMyComment, PaginationMeta } from '../../core/blog.service';
import { AccountComponent } from './account.component';
import { AccountCommentsComponent } from './account-comments.component';

/**
 * AccountCommentsComponent is a thin presentational wrapper that injects the
 * parent AccountComponent and renders the "my comments" section from its
 * reactive state. These tests provide a lightweight mock for the injected
 * AccountComponent so we can drive every template branch and assert real DOM
 * output and that user interactions invoke the parent's methods.
 */
interface MockAccount {
  myCommentsPage: number;
  myComments: WritableSignal<BlogMyComment[]>;
  myCommentsMeta: WritableSignal<PaginationMeta | null>;
  myCommentsLoading: WritableSignal<boolean>;
  myCommentsError: WritableSignal<string | null>;
  loadMyComments: jasmine.Spy;
  prevMyCommentsPage: jasmine.Spy;
  nextMyCommentsPage: jasmine.Spy;
  commentStatusChipClass: jasmine.Spy;
  formatTimestamp: jasmine.Spy;
}

function makeComment(overrides: Partial<BlogMyComment> = {}): BlogMyComment {
  return {
    id: 'c1',
    post_slug: 'my-post',
    post_title: 'My Post',
    parent_id: null,
    body: 'Great article!',
    status: 'posted',
    created_at: '2024-01-01T00:00:00+00:00',
    updated_at: '2024-01-01T00:00:00+00:00',
    reply_count: 0,
    parent: null,
    last_reply: null,
    ...overrides,
  };
}

describe('AccountCommentsComponent', () => {
  let account: MockAccount;
  let fixture: ComponentFixture<AccountCommentsComponent>;

  beforeEach(() => {
    account = {
      myCommentsPage: 3,
      myComments: signal<BlogMyComment[]>([]),
      myCommentsMeta: signal<PaginationMeta | null>(null),
      myCommentsLoading: signal<boolean>(false),
      myCommentsError: signal<string | null>(null),
      loadMyComments: jasmine.createSpy('loadMyComments'),
      prevMyCommentsPage: jasmine.createSpy('prevMyCommentsPage'),
      nextMyCommentsPage: jasmine.createSpy('nextMyCommentsPage'),
      commentStatusChipClass: jasmine
        .createSpy('commentStatusChipClass')
        .and.returnValue('chip-class-token'),
      formatTimestamp: jasmine.createSpy('formatTimestamp').and.returnValue('Jan 1, 2024'),
    };

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AccountCommentsComponent],
      providers: [{ provide: AccountComponent, useValue: account }],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        account: {
          comments: {
            actions: { refresh: 'Refresh', prev: 'Prev', next: 'Next' },
            empty: { title: 'No comments yet.', browse: 'Browse the blog' },
            messages: { deleted: 'This comment was deleted.', hidden: 'This comment is hidden.' },
            replies: { one: 'reply', many: 'replies' },
            pageLabel: 'Page {{page}} of {{total}}',
            replyingTo: 'Replying to {{author}}',
            latest: '{{author}}: {{snippet}}',
          },
        },
        blog: { comments: { anonymous: 'Anonymous' } },
      },
      true,
    );
    translate.setDefaultLang('en');
    void translate.use('en');

    fixture = TestBed.createComponent(AccountCommentsComponent);
  });

  it('creates the component', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows skeleton placeholders while comments are loading', () => {
    account.myCommentsLoading.set(true);
    fixture.detectChanges();

    const skeletons = fixture.debugElement.queryAll(By.css('app-skeleton'));
    expect(skeletons.length).toBe(2);
    expect(fixture.nativeElement.textContent).not.toContain('No comments yet.');
  });

  it('renders the error message when loading fails', () => {
    account.myCommentsError.set('Could not load comments');
    fixture.detectChanges();

    const errorBox = fixture.debugElement.query(By.css('.text-rose-800'));
    expect(errorBox).toBeTruthy();
    expect(errorBox.nativeElement.textContent).toContain('Could not load comments');
  });

  it('renders the empty state with a browse link when there are no comments', () => {
    account.myComments.set([]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No comments yet.');
    const browse = fixture.debugElement.query(By.css('a[routerLink="/blog"]'));
    expect(browse.nativeElement.textContent).toContain('Browse the blog');
  });

  it('refresh button reloads the current page via the parent account', () => {
    fixture.detectChanges();

    const refreshButton = fixture.debugElement.query(By.css('app-button button'));
    refreshButton.nativeElement.click();

    expect(account.loadMyComments).toHaveBeenCalledWith(3);
  });

  it('renders a full comment with status chip, timestamp, body and parent context', () => {
    account.myComments.set([
      makeComment({
        body: 'Insightful reply',
        status: 'posted',
        reply_count: 2,
        parent: { id: 'p1', author_name: 'Alice', snippet: 'Original snippet' },
        last_reply: {
          id: 'r1',
          author_name: 'Bob',
          snippet: 'Latest reply',
          created_at: '2024-02-01T00:00:00+00:00',
        },
      }),
    ]);
    fixture.detectChanges();

    const titleLink = fixture.debugElement
      .queryAll(By.css('a'))
      .find((el) => (el.nativeElement.textContent as string).includes('My Post'));
    expect(titleLink).toBeTruthy();
    expect(titleLink!.nativeElement.getAttribute('href')).toContain('my-post');

    const chip = fixture.debugElement.query(By.css('.rounded-full.whitespace-nowrap'));
    expect(account.commentStatusChipClass).toHaveBeenCalledWith('posted');
    expect(chip.nativeElement.className).toContain('chip-class-token');

    expect(account.formatTimestamp).toHaveBeenCalledWith('2024-01-01T00:00:00+00:00');
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Jan 1, 2024');
    expect(text).toContain('Insightful reply');
    expect(text).toContain('Replying to Alice');
    expect(text).toContain('Original snippet');
    expect(text).toContain('replies');
    expect(text).toContain('Bob: Latest reply');
  });

  it('falls back to post_slug, anonymous authors and single-reply label', () => {
    account.myComments.set([
      makeComment({
        post_title: '',
        body: 'Body text',
        reply_count: 1,
        parent: { id: 'p1', author_name: null, snippet: 'Parent snippet' },
      }),
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('my-post');
    expect(text).toContain('Replying to Anonymous');
    expect(text).toContain('reply');
    expect(text).not.toContain('replies');
  });

  it('shows the deleted placeholder for a deleted comment without a body', () => {
    account.myComments.set([makeComment({ body: '', status: 'deleted' })]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('This comment was deleted.');
  });

  it('shows the hidden placeholder for a hidden comment without a body', () => {
    account.myComments.set([makeComment({ body: '', status: 'hidden' })]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('This comment is hidden.');
  });

  it('disables the previous button on the first page and pages forward', () => {
    account.myComments.set([makeComment()]);
    account.myCommentsMeta.set({ total_items: 30, total_pages: 3, page: 1, limit: 10 });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Page 1 of 3');

    const buttons = fixture.debugElement.queryAll(By.css('app-button button'));
    // buttons: [0] refresh, [1] prev, [2] next
    const prevButton = buttons[1].nativeElement as HTMLButtonElement;
    const nextButton = buttons[2].nativeElement as HTMLButtonElement;

    expect(prevButton.disabled).toBe(true);
    expect(nextButton.disabled).toBe(false);

    nextButton.click();
    expect(account.nextMyCommentsPage).toHaveBeenCalled();
  });

  it('disables the next button on the last page and pages backward', () => {
    account.myComments.set([makeComment()]);
    account.myCommentsMeta.set({ total_items: 30, total_pages: 3, page: 3, limit: 10 });
    fixture.detectChanges();

    const buttons = fixture.debugElement.queryAll(By.css('app-button button'));
    const prevButton = buttons[1].nativeElement as HTMLButtonElement;
    const nextButton = buttons[2].nativeElement as HTMLButtonElement;

    expect(prevButton.disabled).toBe(false);
    expect(nextButton.disabled).toBe(true);

    prevButton.click();
    expect(account.prevMyCommentsPage).toHaveBeenCalled();
  });

  it('uses meta fallbacks when page and total_pages are absent', () => {
    account.myComments.set([makeComment()]);
    account.myCommentsMeta.set({
      total_items: 0,
      total_pages: 0,
      page: 0,
      limit: 10,
    } as PaginationMeta);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Page 1 of 1');
    const buttons = fixture.debugElement.queryAll(By.css('app-button button'));
    expect((buttons[1].nativeElement as HTMLButtonElement).disabled).toBe(true);
    expect((buttons[2].nativeElement as HTMLButtonElement).disabled).toBe(true);
  });
});
