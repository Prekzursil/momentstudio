import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export interface HttpErrorEvent {
  status: number;
  method: string;
  url: string;
}

@Injectable({ providedIn: 'root' })
export class HttpErrorBusService {
  private readonly subject = new Subject<HttpErrorEvent>();
  readonly events$: Observable<HttpErrorEvent> = this.subject.asObservable();

  emit(event: HttpErrorEvent): void {
    this.subject.next(event);
  }
}

