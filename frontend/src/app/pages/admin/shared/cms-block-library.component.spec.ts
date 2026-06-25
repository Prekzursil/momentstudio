import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { CmsBlockLibraryBlockType, CmsBlockLibraryComponent } from './cms-block-library.component';

describe('CmsBlockLibraryComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CmsBlockLibraryComponent, TranslateModule.forRoot()],
    });
  });

  function create(): CmsBlockLibraryComponent {
    const fixture = TestBed.createComponent(CmsBlockLibraryComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('creates and renders all blocks by default', () => {
    const fixture = TestBed.createComponent(CmsBlockLibraryComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    const cards = fixture.nativeElement.querySelectorAll('[draggable="true"]');
    expect(cards.length).toBe(fixture.componentInstance.blocks.length);
  });

  it('returns all blocks when allowedTypes is null', () => {
    const cmp = create();
    cmp.allowedTypes = null;
    expect(cmp.filteredBlocks().length).toBe(cmp.blocks.length);
  });

  it('returns all blocks when allowedTypes is empty', () => {
    const cmp = create();
    cmp.allowedTypes = [];
    expect(cmp.filteredBlocks().length).toBe(cmp.blocks.length);
  });

  it('filters blocks to the allowed types', () => {
    const cmp = create();
    cmp.allowedTypes = ['text', 'cta'];
    const types = cmp.filteredBlocks().map((b) => b.type);
    expect(types).toEqual(['text', 'cta']);
  });

  it('emits add with the active template', () => {
    const cmp = create();
    const emitted: Array<{ type: CmsBlockLibraryBlockType; template: string }> = [];
    cmp.add.subscribe((v) => emitted.push(v));
    cmp.template.set('blank');
    cmp.addBlock('faq');
    expect(emitted).toEqual([{ type: 'faq', template: 'blank' }]);
  });

  it('sets drag payload and emits dragActive on drag start', () => {
    const cmp = create();
    cmp.context = 'home';
    let active: boolean | null = null;
    cmp.dragActive.subscribe((v) => (active = v));
    const setData = jasmine.createSpy('setData');
    const dataTransfer = { setData, effectAllowed: '' } as unknown as DataTransfer;
    const event = { dataTransfer } as unknown as DragEvent;

    cmp.onDragStart(event, 'text');

    expect(setData).toHaveBeenCalledWith(
      'text/plain',
      JSON.stringify({ kind: 'cms-block', scope: 'home', type: 'text', template: 'starter' }),
    );
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(active).toBeTrue();
  });

  it('still emits dragActive when there is no dataTransfer', () => {
    const cmp = create();
    let active: boolean | null = null;
    cmp.dragActive.subscribe((v) => (active = v));
    cmp.onDragStart({ dataTransfer: null } as unknown as DragEvent, 'cta');
    expect(active).toBeTrue();
  });

  it('swallows errors raised while writing the drag payload', () => {
    const cmp = create();
    let active: boolean | null = null;
    cmp.dragActive.subscribe((v) => (active = v));
    const dataTransfer = {
      setData: () => {
        throw new Error('denied');
      },
      effectAllowed: '',
    } as unknown as DataTransfer;
    expect(() => cmp.onDragStart({ dataTransfer } as unknown as DragEvent, 'image')).not.toThrow();
    expect(active).toBeTrue();
  });

  it('emits dragActive false on drag end', () => {
    const cmp = create();
    let active: boolean | null = null;
    cmp.dragActive.subscribe((v) => (active = v));
    cmp.onDragEnd();
    expect(active).toBeFalse();
  });
});
