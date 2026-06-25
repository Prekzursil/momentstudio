import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { LoadingStateComponent } from './loading-state.component';
import { SkeletonComponent } from './skeleton.component';

describe('LoadingStateComponent', () => {
  let fixture: ComponentFixture<LoadingStateComponent>;
  let component: LoadingStateComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [LoadingStateComponent] });
    fixture = TestBed.createComponent(LoadingStateComponent);
    component = fixture.componentInstance;
  });

  it('renders one placeholder card per row', () => {
    component.rows = 2;
    fixture.detectChanges();
    const cards = fixture.debugElement.queryAll(By.css('.grid.gap-2'));
    expect(cards.length).toBe(2);
    expect(fixture.debugElement.queryAll(By.directive(SkeletonComponent)).length).toBe(6);
  });

  it('clamps rows to a minimum of one', () => {
    component.rows = 0;
    expect(component.placeholders).toEqual([0]);
    component.rows = -5;
    expect(component.placeholders).toEqual([0]);
  });

  it('applies padding when padded', () => {
    component.padded = true;
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.grid.gap-3')).nativeElement.classList).toContain(
      'p-4',
    );
  });
});
