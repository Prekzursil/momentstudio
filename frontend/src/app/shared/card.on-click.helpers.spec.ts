import { CardComponent } from './card.component';

/** Golden WU shared-card-title-slot — clickable card action arms. */
describe('CardComponent onClick (golden WU)', () => {
  it('ignores click when not clickable', () => {
    const cmp = Object.create(CardComponent.prototype) as CardComponent;
    cmp.clickable = false;
    cmp.action = { emit: jasmine.createSpy('emit') } as any;
    cmp.onClick({ target: document.createElement('div') } as MouseEvent);
    expect(cmp.action.emit).not.toHaveBeenCalled();
  });

  it('emits action for clickable non-interactive target', () => {
    const cmp = Object.create(CardComponent.prototype) as CardComponent;
    cmp.clickable = true;
    cmp.action = { emit: jasmine.createSpy('emit') } as any;
    cmp.onClick({ target: document.createElement('div') } as MouseEvent);
    expect(cmp.action.emit).toHaveBeenCalled();
  });
});
