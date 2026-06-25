import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';

import { CardComponent } from './card.component';

@Component({
  standalone: true,
  imports: [CardComponent],
  template: `
    <app-card [title]="title" [subtitle]="subtitle" [clickable]="clickable" (action)="onAction()">
      <button type="button" class="inner-btn">inner</button>
      <span class="plain">plain</span>
    </app-card>
  `,
})
class HostComponent {
  title = '';
  subtitle = '';
  clickable = false;
  actionCount = 0;
  onAction(): void {
    this.actionCount += 1;
  }
}

describe('CardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function cardEl(): HTMLElement {
    return fixture.nativeElement.querySelector('app-card > div') as HTMLElement;
  }

  it('creates and hides title/subtitle when empty', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('My Title');
    const el = cardEl();
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('tabindex')).toBeNull();
  });

  it('renders title and subtitle when provided', () => {
    host.title = 'My Title';
    host.subtitle = 'My Subtitle';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('My Title');
    expect(fixture.nativeElement.textContent).toContain('My Subtitle');
  });

  it('adds button role and tabindex when clickable', () => {
    host.clickable = true;
    fixture.detectChanges();
    const el = cardEl();
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.className).toContain('cursor-pointer');
  });

  it('does nothing on click when not clickable', () => {
    host.clickable = false;
    fixture.detectChanges();
    cardEl().click();
    expect(host.actionCount).toBe(0);
  });

  it('emits action on plain click when clickable', () => {
    host.clickable = true;
    fixture.detectChanges();
    const plain = fixture.nativeElement.querySelector('.plain') as HTMLElement;
    plain.click();
    expect(host.actionCount).toBe(1);
  });

  it('ignores clicks that originate from interactive elements', () => {
    host.clickable = true;
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.inner-btn') as HTMLElement;
    btn.click();
    expect(host.actionCount).toBe(0);
  });

  it('does nothing on keydown when not clickable', () => {
    host.clickable = false;
    fixture.detectChanges();
    cardEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(host.actionCount).toBe(0);
  });

  it('ignores non-activation keys when clickable', () => {
    host.clickable = true;
    fixture.detectChanges();
    cardEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(host.actionCount).toBe(0);
  });

  it('emits action on Enter and Space when clickable', () => {
    host.clickable = true;
    fixture.detectChanges();
    cardEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    cardEl().dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(host.actionCount).toBe(2);
  });
});
