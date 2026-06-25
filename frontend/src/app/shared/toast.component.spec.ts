import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';

import { ToastComponent, type ToastMessage } from './toast.component';
import { ToastService } from '../core/toast.service';

describe('ToastComponent', () => {
  let fixture: ComponentFixture<ToastComponent>;
  let component: ToastComponent;
  let toastService: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    toastService = jasmine.createSpyObj<ToastService>('ToastService', ['clear']);
    await TestBed.configureTestingModule({
      imports: [ToastComponent],
      providers: [{ provide: ToastService, useValue: toastService }],
    }).compileComponents();
    fixture = TestBed.createComponent(ToastComponent);
    component = fixture.componentInstance;
  });

  function triggerChange(messages: ToastMessage[]): void {
    component.messages = messages;
    component.ngOnChanges({ messages: new SimpleChange(null, messages, true) });
  }

  it('creates', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('ignores ngOnChanges without a messages change', () => {
    component.ngOnChanges({});
    expect(component.livePolite).toBe('');
    expect(component.liveAssertive).toBe('');
  });

  it('ignores when there is no latest message', () => {
    triggerChange([]);
    expect(component.livePolite).toBe('');
  });

  it('ignores when latest message has no text', () => {
    triggerChange([{ id: '1', title: '' }]);
    expect(component.livePolite).toBe('');
    expect(component.liveAssertive).toBe('');
  });

  it('announces non-error toasts politely', () => {
    triggerChange([{ id: '1', title: 'Hi', description: 'there', tone: 'info' }]);
    expect(component.livePolite).toBe('Hi. there');
    expect(component.liveAssertive).toBe('');
  });

  it('announces error toasts assertively', () => {
    triggerChange([{ id: '1', title: 'Boom', tone: 'error' }]);
    expect(component.liveAssertive).toBe('Boom');
    expect(component.livePolite).toBe('');
  });

  it('renders toast list with description and tone classes', () => {
    component.messages = [
      { id: 's', title: 'Saved', description: 'ok', tone: 'success' },
      { id: 'e', title: 'Err', tone: 'error' },
    ];
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('Saved');
    expect(html.textContent).toContain('ok');
    expect(html.querySelector('.border-green-200')).toBeTruthy();
    expect(html.querySelector('.border-red-200')).toBeTruthy();
  });

  it('renders an action button and runs the action', () => {
    const onAction = jasmine.createSpy('onAction');
    component.messages = [
      { id: 'a', title: 'Undo?', actionLabel: 'Undo', actionAriaLabel: 'Undo it', onAction },
    ];
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Undo it');
    btn.click();
    expect(toastService.clear).toHaveBeenCalledWith('a');
    expect(onAction).toHaveBeenCalled();
  });

  it('runAction returns early when handler is missing', () => {
    const event = new MouseEvent('click');
    spyOn(event, 'preventDefault');
    spyOn(event, 'stopPropagation');
    component.runAction({ id: 'x', title: 't', onAction: null }, event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(toastService.clear).not.toHaveBeenCalled();
  });

  it('falls back to actionLabel for aria-label when no actionAriaLabel', () => {
    component.messages = [{ id: 'a', title: 'T', actionLabel: 'Do', onAction: () => {} }];
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Do');
  });
});
