import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';

import { ButtonComponent } from '../../../shared/button.component';
import { AdminProductsEditorWizardComponent } from './admin-products-editor-wizard.component';

describe('AdminProductsEditorWizardComponent', () => {
  let fixture: ComponentFixture<AdminProductsEditorWizardComponent>;
  let component: AdminProductsEditorWizardComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminProductsEditorWizardComponent],
    });
    fixture = TestBed.createComponent(AdminProductsEditorWizardComponent);
    component = fixture.componentInstance;
  });

  // With no translations loaded, the translate pipe echoes the key, so the
  // rendered button label equals the *.labelKey we bind.
  function appButtonByLabel(label: string): HTMLButtonElement {
    const de = fixture.debugElement
      .queryAll(By.directive(ButtonComponent))
      .find((d) => (d.componentInstance as ButtonComponent).label === label);
    if (!de) {
      throw new Error(`app-button with label "${label}" not found`);
    }
    return de.nativeElement.querySelector('button') as HTMLButtonElement;
  }

  function appButtonExists(label: string): boolean {
    return fixture.debugElement
      .queryAll(By.directive(ButtonComponent))
      .some((d) => (d.componentInstance as ButtonComponent).label === label);
  }

  function stepButtons(): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'button.border-indigo-200',
      ),
    );
  }

  it('renders title, description and one selectable button per step', () => {
    component.titleKey = 'Wizard title';
    component.descriptionKey = 'Wizard description';
    component.steps = [{ labelKey: 'Step A' }, { labelKey: 'Step B' }, { labelKey: 'Step C' }];
    component.stepIndex = 1;
    component.currentStepId = 'save';
    component.nextLabelKey = 'Continue';
    component.canNext = true;
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('p.font-semibold')?.textContent).toContain('Wizard title');
    expect(root.querySelector('p.text-xs')?.textContent).toContain('Wizard description');

    const steps = stepButtons();
    expect(steps.length).toBe(3);
    expect(steps[0].textContent?.trim()).toBe('Step A');
    expect(steps[2].textContent?.trim()).toBe('Step C');
  });

  it('applies the active highlight only to the current step index', () => {
    component.steps = [{ labelKey: 'A' }, { labelKey: 'B' }];
    component.stepIndex = 0;
    component.currentStepId = 'save';
    component.nextLabelKey = 'Next';
    fixture.detectChanges();

    const steps = stepButtons();
    // idx === stepIndex (true branch) gets the active classes; the other (false) does not.
    expect(steps[0].classList.contains('bg-indigo-600')).toBeTrue();
    expect(steps[0].classList.contains('text-white')).toBeTrue();
    expect(steps[1].classList.contains('bg-indigo-600')).toBeFalse();
    expect(steps[1].classList.contains('text-white')).toBeFalse();
  });

  it('emits exit, stepSelected and prev/next from their buttons', () => {
    component.steps = [{ labelKey: 'A' }, { labelKey: 'B' }];
    component.stepIndex = 1; // back button enabled (stepIndex !== 0)
    component.currentStepId = 'save';
    component.nextLabelKey = 'Next step';
    component.canNext = true; // next button enabled
    fixture.detectChanges();

    const exitSpy = jasmine.createSpy('exit');
    const stepSpy = jasmine.createSpy('stepSelected');
    const prevSpy = jasmine.createSpy('prev');
    const nextSpy = jasmine.createSpy('next');
    component.exit.subscribe(exitSpy);
    component.stepSelected.subscribe(stepSpy);
    component.prev.subscribe(prevSpy);
    component.next.subscribe(nextSpy);

    appButtonByLabel('adminUi.actions.exit').click();
    expect(exitSpy).toHaveBeenCalledTimes(1);

    stepButtons()[0].click();
    expect(stepSpy).toHaveBeenCalledOnceWith(0);

    appButtonByLabel('adminUi.actions.back').click();
    expect(prevSpy).toHaveBeenCalledTimes(1);

    appButtonByLabel('Next step').click();
    expect(nextSpy).toHaveBeenCalledTimes(1);
  });

  it('shows the save action on the save step and emits save on click', () => {
    component.steps = [{ labelKey: 'A' }];
    component.stepIndex = 0;
    component.currentStepId = 'save';
    component.nextLabelKey = 'Next';
    fixture.detectChanges();

    expect(appButtonExists('adminUi.products.form.save')).toBeTrue();
    expect(appButtonExists('adminUi.products.wizard.publishNow')).toBeFalse();

    const saveSpy = jasmine.createSpy('save');
    component.save.subscribe(saveSpy);
    appButtonByLabel('adminUi.products.form.save').click();
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('disables back on the first step and next when canNext is false', () => {
    component.steps = [{ labelKey: 'A' }];
    component.stepIndex = 0; // back disabled (stepIndex === 0)
    component.currentStepId = 'publish';
    component.nextLabelKey = 'Next';
    component.canNext = false; // next disabled
    component.hasEditingSlug = false; // publish disabled (!hasEditingSlug)
    fixture.detectChanges();

    expect(appButtonByLabel('adminUi.actions.back').disabled).toBeTrue();
    expect(appButtonByLabel('Next').disabled).toBeTrue();

    // publishNow rendered but disabled -> click must not emit
    const publishBtn = appButtonByLabel('adminUi.products.wizard.publishNow');
    expect(publishBtn.disabled).toBeTrue();
    const publishSpy = jasmine.createSpy('publishNow');
    component.publishNow.subscribe(publishSpy);
    publishBtn.click();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('enables publishNow on the publish step when a slug is set and emits on click', () => {
    component.steps = [{ labelKey: 'A' }];
    component.stepIndex = 0;
    component.currentStepId = 'publish';
    component.nextLabelKey = 'Next';
    component.hasEditingSlug = true; // publish enabled
    fixture.detectChanges();

    expect(appButtonExists('adminUi.products.form.save')).toBeFalse();

    const publishBtn = appButtonByLabel('adminUi.products.wizard.publishNow');
    expect(publishBtn.disabled).toBeFalse();
    const publishSpy = jasmine.createSpy('publishNow');
    component.publishNow.subscribe(publishSpy);
    publishBtn.click();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it('renders neither save nor publish action on intermediate steps', () => {
    component.steps = [{ labelKey: 'A' }, { labelKey: 'B' }];
    component.stepIndex = 0;
    component.currentStepId = 'details';
    component.nextLabelKey = 'Next';
    fixture.detectChanges();

    expect(appButtonExists('adminUi.products.form.save')).toBeFalse();
    expect(appButtonExists('adminUi.products.wizard.publishNow')).toBeFalse();
  });
});
