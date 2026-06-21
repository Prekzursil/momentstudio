import { fakeAsync, tick, TestBed } from '@angular/core/testing';

import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ToastService] });
    service = TestBed.inject(ToastService);
  });

  it('starts empty', () => {
    expect(service.messages()()).toEqual([]);
  });

  it('pushes info/success/error toasts with the right tone', () => {
    service.info('I', 'idesc');
    service.success('S');
    service.error('E');
    const msgs = service.messages()();
    expect(msgs.map((m) => m.tone)).toEqual(['info', 'success', 'error']);
    expect(msgs[0].description).toBe('idesc');
  });

  it('deduplicates identical non-action toasts', () => {
    service.info('Dup', 'same');
    service.info('Dup', 'same');
    expect(service.messages()().length).toBe(1);
  });

  it('does not deduplicate action toasts', () => {
    const onAction = jasmine.createSpy('onAction');
    service.action('A', 'Undo', onAction);
    service.action('A', 'Undo', onAction);
    expect(service.messages()().length).toBe(2);
  });

  it('supports action toast options and defaults', () => {
    const onAction = jasmine.createSpy('onAction');
    service.action('Title', 'Label', onAction, {
      description: 'd',
      tone: 'success',
      actionAriaLabel: 'aria',
      durationMs: 0,
    });
    const msg = service.messages()()[0];
    expect(msg.tone).toBe('success');
    expect(msg.actionLabel).toBe('Label');
    expect(msg.actionAriaLabel).toBe('aria');
    expect(msg.onAction).toBe(onAction);
  });

  it('defaults action tone to info', () => {
    service.action('Title', 'Label', () => {}, { durationMs: 0 });
    expect(service.messages()()[0].tone).toBe('info');
  });

  it('auto-clears after the duration', fakeAsync(() => {
    service.info('Auto');
    expect(service.messages()().length).toBe(1);
    tick(4000);
    expect(service.messages()().length).toBe(0);
  }));

  it('does not auto-clear when duration is zero', fakeAsync(() => {
    service.action('Persist', 'Do', () => {}, { durationMs: 0 });
    tick(10000);
    expect(service.messages()().length).toBe(1);
  }));

  it('clears a single toast by id', () => {
    service.info('Keep');
    service.success('Remove');
    const removeId = service.messages()()[1].id;
    service.clear(removeId);
    const titles = service
      .messages()()
      .map((m) => m.title);
    expect(titles).toEqual(['Keep']);
  });

  it('clears all toasts', () => {
    service.info('a');
    service.success('b');
    service.clearAll();
    expect(service.messages()()).toEqual([]);
  });
});
