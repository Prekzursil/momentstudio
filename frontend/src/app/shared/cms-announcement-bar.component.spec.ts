import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { of, throwError } from 'rxjs';

import { ApiService } from '../core/api.service';
import { MarkdownService } from '../core/markdown.service';
import { TranslateService } from '@ngx-translate/core';
import { CmsAnnouncementBarComponent } from './cms-announcement-bar.component';

describe('CmsAnnouncementBarComponent', () => {
  let fixture: ComponentFixture<CmsAnnouncementBarComponent>;
  let component: CmsAnnouncementBarComponent;
  let api: jasmine.SpyObj<ApiService>;
  let markdown: jasmine.SpyObj<MarkdownService>;
  let langChange: Subject<unknown>;
  let translate: { currentLang: string; onLangChange: Subject<unknown> };

  function configure(): void {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
    markdown.render.and.callFake((md: string) => `<p>${md}</p>`);
    langChange = new Subject();
    translate = { currentLang: 'en', onLangChange: langChange };
    TestBed.configureTestingModule({
      imports: [CmsAnnouncementBarComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: MarkdownService, useValue: markdown },
        { provide: TranslateService, useValue: translate },
      ],
    });
    fixture = TestBed.createComponent(CmsAnnouncementBarComponent);
    component = fixture.componentInstance;
  }

  beforeEach(configure);

  it('renders sanitized HTML from the first text block', () => {
    api.get.and.returnValue(of({ meta: { blocks: [{ type: 'text', body_markdown: 'hello' }] } }));
    fixture.detectChanges();
    expect(component.html()).toContain('hello');
    expect((fixture.nativeElement as HTMLElement).querySelector('.markdown')).toBeTruthy();
  });

  it('requests the Romanian content when the current lang is ro', () => {
    translate.currentLang = 'ro';
    api.get.and.returnValue(of({ meta: { blocks: [] } }));
    fixture.detectChanges();
    expect(api.get).toHaveBeenCalledWith('/content/site.announcement', { lang: 'ro' });
  });

  it('sets html to null when there is no text block', () => {
    api.get.and.returnValue(of({ meta: { blocks: [] } }));
    fixture.detectChanges();
    expect(component.html()).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.markdown')).toBeNull();
  });

  it('handles a missing meta on the block', () => {
    api.get.and.returnValue(of({}));
    fixture.detectChanges();
    expect(component.html()).toBeNull();
  });

  it('sets html to null when an empty text body is returned', () => {
    markdown.render.and.returnValue('   ');
    api.get.and.returnValue(of({ meta: { blocks: [{ type: 'text', body_markdown: '' }] } }));
    fixture.detectChanges();
    expect(component.html()).toBeNull();
  });

  it('resets html to null on API error', () => {
    api.get.and.returnValue(throwError(() => new Error('boom')));
    fixture.detectChanges();
    expect(component.html()).toBeNull();
  });

  it('reloads when the language changes', () => {
    api.get.and.returnValue(of({ meta: { blocks: [{ type: 'text', body_markdown: 'a' }] } }));
    fixture.detectChanges();
    expect(api.get).toHaveBeenCalledTimes(1);

    api.get.and.returnValue(of({ meta: { blocks: [{ type: 'text', body_markdown: 'b' }] } }));
    langChange.next({ lang: 'ro' });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes from language changes on destroy', () => {
    api.get.and.returnValue(of({ meta: { blocks: [] } }));
    fixture.detectChanges();
    fixture.destroy();
    api.get.calls.reset();
    langChange.next({ lang: 'ro' });
    expect(api.get).not.toHaveBeenCalled();
  });
});
