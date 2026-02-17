import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AnalyticsService } from './analytics.service';
import { ApiService } from './api.service';

describe('AnalyticsService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: ApiService,
          useValue: {
            post: () => of({ token: 'stub-token', expires_in: 3600, received: true }),
          },
        },
      ],
    });
  });

  it('emits an analytics opt-in event whenever consent is toggled', () => {
    const service = TestBed.inject(AnalyticsService);
    let received: boolean | null = null;
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ enabled?: boolean }>;
      received = Boolean(custom.detail?.enabled);
    };

    window.addEventListener('app:analytics-opt-in', handler);
    service.setEnabled(false);
    window.removeEventListener('app:analytics-opt-in', handler);

    expect(received).toBeFalse();
  });
});
