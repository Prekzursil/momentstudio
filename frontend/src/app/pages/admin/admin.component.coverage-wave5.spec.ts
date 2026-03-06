import { throwError } from 'rxjs';

import { AdminComponent } from './admin.component';

type SignalLike<T> = (() => T) & { set: (next: T) => void };

function makeSignal<T>(initial: T): SignalLike<T> {
  let value = initial;
  const fn = (() => value) as SignalLike<T>;
  fn.set = (next: T) => {
    value = next;
  };
  return fn;
}

function createComponent(): any {
  const component: any = Object.create(AdminComponent.prototype);
  component.categoryWizardOpen = makeSignal(false);
  component.categoryWizardStep = makeSignal(0);
  component.categoryWizardSlug = makeSignal<string | null>(null);
  component.categoryWizardSteps = [
    { descriptionKey: 'step.one' },
    { descriptionKey: 'step.two' },
    { descriptionKey: 'step.three' },
  ];
  component.toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
  component.t = (key: string) => key;
  component.categories = [];
  component.admin = jasmine.createSpyObj('AdminService', ['reorderCategories']);
  component.loadCategoryTranslations = jasmine.createSpy('loadCategoryTranslations');
  component.categoryTranslationsSlug = null;
  return component;
}

describe('AdminComponent coverage wave 5', () => {
  it('advances and exits category wizard through guarded steps', () => {
    const component = createComponent();
    const translationsSpy = spyOn(component, 'openCategoryWizardTranslations').and.stub();

    component.startCategoryWizard();
    component.categoryWizardPrev();
    expect(component.categoryWizardStep()).toBe(0);

    component.categoryWizardSlug.set('gifts');
    component.categoryWizardNext();
    expect(component.categoryWizardStep()).toBe(1);
    expect(translationsSpy).toHaveBeenCalled();

    component.categoryWizardStep.set(component.categoryWizardSteps.length - 1);
    component.categoryWizardNext();
    expect(component.categoryWizardOpen()).toBeFalse();
    expect(component.categoryWizardStep()).toBe(0);
    expect(component.categoryWizardSlug()).toBeNull();
  });

  it('blocks wizard deep-linking when no category slug exists', () => {
    const component = createComponent();
    const translationsSpy = spyOn(component, 'openCategoryWizardTranslations').and.stub();
    component.startCategoryWizard();

    component.goToCategoryWizardStep(1);
    expect(component.toast.error).toHaveBeenCalledWith('adminUi.categories.wizard.addFirst');
    expect(component.categoryWizardStep()).toBe(0);

    component.categoryWizardSlug.set('studio');
    component.goToCategoryWizardStep(1);
    expect(component.categoryWizardStep()).toBe(1);
    expect(translationsSpy).toHaveBeenCalled();
  });

  it('surfaces category reorder API failures', () => {
    const component = createComponent();
    component.categories = [
      { slug: 'first', sort_order: 0 },
      { slug: 'second', sort_order: 1 },
    ];
    component.admin.reorderCategories.and.returnValue(
      throwError(() => new Error('reorder failed'))
    );

    component.moveCategory(component.categories[0], 1);

    expect(component.admin.reorderCategories).toHaveBeenCalled();
    expect(component.toast.error).toHaveBeenCalledWith('adminUi.categories.errors.reorder');
  });
});
