import type { EngineEvent, Unsubscribe } from '@bango/core';

export class EventBus {
  private listeners = new Set<(event: EngineEvent) => void>();

  subscribe(listener: (event: EngineEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(event: EngineEvent) {
    for (const l of [...this.listeners]) {
      try { l(event); } catch { /* a faulty listener must not break the engine */ }
    }
  }

  clear() {
    this.listeners.clear();
  }
}
