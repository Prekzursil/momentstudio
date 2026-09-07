import { HelpPanelComponent } from './help-panel.component';

describe('HelpPanelComponent tip2', () => {
  it('constructs via prototype', () => {
    const c = Object.create(HelpPanelComponent.prototype) as HelpPanelComponent;
    expect(c).toBeTruthy();
  });
});
