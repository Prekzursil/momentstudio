import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { LazyStylesService } from './lazy-styles.service';

describe('LazyStylesService', () => {
  let service: LazyStylesService;
  let appendedLinks: HTMLLinkElement[];
  let fakeHead: { appendChild: jasmine.Spy };
  let doc: Document;

  beforeEach(() => {
    appendedLinks = [];
    fakeHead = {
      appendChild: jasmine.createSpy('appendChild').and.callFake((link: HTMLLinkElement) => {
        appendedLinks.push(link);
        return link;
      }),
    };
    doc = {
      querySelector: jasmine.createSpy('querySelector').and.returnValue(null),
      createElement: (tag: string) => document.createElement(tag),
      head: fakeHead as unknown as HTMLHeadElement,
    } as unknown as Document;

    TestBed.configureTestingModule({
      providers: [LazyStylesService, { provide: DOCUMENT, useValue: doc }],
    });
    service = TestBed.inject(LazyStylesService);
  });

  it('resolves immediately when the stylesheet already exists', async () => {
    (doc.querySelector as jasmine.Spy).and.returnValue(document.createElement('link'));
    await service.ensure('theme', '/a.css');
    expect(fakeHead.appendChild).not.toHaveBeenCalled();
  });

  it('appends a link and resolves on load', async () => {
    const promise = service.ensure('theme', '/a.css');
    const link = appendedLinks[0];
    expect(link.rel).toBe('stylesheet');
    expect(link.href).toContain('/a.css');
    expect(link.dataset['lazyStyle']).toBe('theme');
    link.onload?.(new Event('load'));
    await expectAsync(promise).toBeResolved();
  });

  it('returns the same inflight promise for concurrent calls', () => {
    const first = service.ensure('theme', '/a.css');
    const second = service.ensure('theme', '/a.css');
    expect(second).toBe(first);
    expect(fakeHead.appendChild).toHaveBeenCalledTimes(1);
    appendedLinks[0].onload?.(new Event('load'));
  });

  it('rejects and removes the link on error', async () => {
    const promise = service.ensure('theme', '/bad.css');
    const link = appendedLinks[0];
    const removeSpy = spyOn(link, 'remove').and.callThrough();
    link.onerror?.(new Event('error'));
    await expectAsync(promise).toBeRejectedWithError('Failed to load stylesheet: /bad.css');
    expect(removeSpy).toHaveBeenCalled();
  });
});
