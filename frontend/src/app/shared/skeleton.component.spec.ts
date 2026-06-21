import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SkeletonComponent } from './skeleton.component';

describe('SkeletonComponent', () => {
  let fixture: ComponentFixture<SkeletonComponent>;
  let component: SkeletonComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SkeletonComponent] }).compileComponents();
    fixture = TestBed.createComponent(SkeletonComponent);
    component = fixture.componentInstance;
  });

  it('renders a single skeleton by default', () => {
    fixture.detectChanges();
    const blocks = (fixture.nativeElement as HTMLElement).querySelectorAll('div[style]');
    expect(blocks.length).toBe(1);
  });

  it('renders multiple rows when rows > 1', () => {
    component.rows = 3;
    fixture.detectChanges();
    const blocks = (fixture.nativeElement as HTMLElement).querySelectorAll('.grid > div');
    expect(blocks.length).toBe(3);
  });

  describe('rowIndexes', () => {
    it('returns a clamped, integer-length range', () => {
      component.rows = 4;
      expect(component.rowIndexes()).toEqual([0, 1, 2, 3]);
    });

    it('returns an empty array for invalid row counts', () => {
      component.rows = -5;
      expect(component.rowIndexes()).toEqual([]);
      component.rows = NaN as never;
      expect(component.rowIndexes()).toEqual([]);
    });
  });

  describe('rowWidth', () => {
    it('returns the configured width for a single row', () => {
      component.rows = 1;
      component.width = '50%';
      expect(component.rowWidth(0)).toBe('50%');
    });

    it('returns the configured width when it is not 100%', () => {
      component.rows = 3;
      component.width = '80%';
      expect(component.rowWidth(0)).toBe('80%');
    });

    it('tapers the last two rows when width is 100%', () => {
      component.rows = 4;
      component.width = '100%';
      expect(component.rowWidth(0)).toBe('100%');
      expect(component.rowWidth(2)).toBe('88%');
      expect(component.rowWidth(3)).toBe('72%');
    });

    it('returns the penultimate taper for the second-to-last row', () => {
      component.rows = 5;
      component.width = '100%';
      // index 3 is penultimate (rows - 2), index 1 is a middle row.
      expect(component.rowWidth(3)).toBe('88%');
      expect(component.rowWidth(1)).toBe('100%');
    });

    it('returns the configured width when it is falsy (not 100%)', () => {
      component.rows = 3;
      component.width = '' as never;
      // A falsy width exercises the `this.width || ''` fallback and is not 100%.
      expect(component.rowWidth(2)).toBe('');
    });
  });
});
