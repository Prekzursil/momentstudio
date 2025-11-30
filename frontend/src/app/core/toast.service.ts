import { Injectable, signal } from '@angular/core';
import { ToastMessage } from '../shared/toast.component';
import { v4 as uuidv4 } from 'uuid';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly messagesSignal = signal<ToastMessage[]>([]);

  messages() {
    return this.messagesSignal.asReadonly();
  }

  info(title: string, description?: string): void {
    this.push({ title, description, tone: 'info' });
  }

  success(title: string, description?: string): void {
    this.push({ title, description, tone: 'success' });
  }

  error(title: string, description?: string): void {
    this.push({ title, description, tone: 'error' });
  }

  clear(id: string): void {
    this.messagesSignal.update((msgs) => msgs.filter((m) => m.id !== id));
  }

  clearAll(): void {
    this.messagesSignal.set([]);
  }

  private push(message: Omit<ToastMessage, 'id'>): void {
    const id = uuidv4();
    this.messagesSignal.update((msgs) => [...msgs, { id, ...message }]);
    setTimeout(() => this.clear(id), 4000);
  }
}
