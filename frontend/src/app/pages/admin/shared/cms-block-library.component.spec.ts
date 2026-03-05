import { CmsBlockLibraryComponent } from './cms-block-library.component';

describe('CmsBlockLibraryComponent', () => {
  function createComponent(): CmsBlockLibraryComponent {
    return new CmsBlockLibraryComponent();
  }

  it('filters blocks by allowed types', () => {
    const component = createComponent();
    expect(component.filteredBlocks().length).toBe(component.blocks.length);

    component.allowedTypes = ['text', 'gallery'];
    const filtered = component.filteredBlocks();
    expect(filtered.map((b) => b.type)).toEqual(['text', 'gallery']);
  });

  it('emits add event with current template', () => {
    const component = createComponent();
    const emitSpy = spyOn(component.add, 'emit');

    component.template.set('blank');
    component.addBlock('cta');

    expect(emitSpy).toHaveBeenCalledWith({ type: 'cta', template: 'blank' });
  });

  it('emits drag-active and payload during drag start', () => {
    const component = createComponent();
    const dragEmitSpy = spyOn(component.dragActive, 'emit');
    const setDataSpy = jasmine.createSpy('setData');
    const event = {
      dataTransfer: {
        setData: setDataSpy,
        effectAllowed: 'none',
      },
    } as unknown as DragEvent;

    component.context = 'home';
    component.template.set('starter');
    component.onDragStart(event, 'banner');

    expect(setDataSpy).toHaveBeenCalled();
    const payload = JSON.parse(setDataSpy.calls.mostRecent().args[1] as string);
    expect(payload).toEqual({ kind: 'cms-block', scope: 'home', type: 'banner', template: 'starter' });
    expect(event.dataTransfer?.effectAllowed).toBe('copy');
    expect(dragEmitSpy).toHaveBeenCalledWith(true);
  });

  it('swallows drag payload errors and still emits drag-active', () => {
    const component = createComponent();
    const dragEmitSpy = spyOn(component.dragActive, 'emit');
    const event = {
      dataTransfer: {
        setData: () => {
          throw new Error('setData-fail');
        },
      },
    } as unknown as DragEvent;

    component.onDragStart(event, 'text');

    expect(dragEmitSpy).toHaveBeenCalledWith(true);
  });

  it('emits false on drag end', () => {
    const component = createComponent();
    const dragEmitSpy = spyOn(component.dragActive, 'emit');

    component.onDragEnd();

    expect(dragEmitSpy).toHaveBeenCalledWith(false);
  });
});
