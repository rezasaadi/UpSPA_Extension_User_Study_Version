import type { ExtensionEvent, ExtensionEventMap, ExtensionEventType } from './extensionEvents';

export type EventUnsubscribe = () => void;
type AnyEventHandler = (event: ExtensionEvent) => void | Promise<void>;
type TypedEventHandler<K extends ExtensionEventType> = (event: ExtensionEventMap[K]) => void | Promise<void>;

export class ExtensionEventBus {
  private readonly listeners = new Map<ExtensionEventType, Set<AnyEventHandler>>();
  private readonly anyListeners = new Set<AnyEventHandler>();

  on<K extends ExtensionEventType>(type: K, handler: TypedEventHandler<K>): EventUnsubscribe {
    const handlers = this.listeners.get(type) ?? new Set<AnyEventHandler>();
    handlers.add(handler as AnyEventHandler);
    this.listeners.set(type, handlers);
    return () => handlers.delete(handler as AnyEventHandler);
  }

  onAny(handler: AnyEventHandler): EventUnsubscribe {
    this.anyListeners.add(handler);
    return () => this.anyListeners.delete(handler);
  }

  async emit(event: ExtensionEvent): Promise<void> {
    const typedHandlers = [...(this.listeners.get(event.type) ?? [])];
    const anyHandlers = [...this.anyListeners];
    for (const handler of [...typedHandlers, ...anyHandlers]) {
      await handler(event);
    }
  }

  clear(): void {
    this.listeners.clear();
    this.anyListeners.clear();
  }
}

export function createExtensionEventBus(): ExtensionEventBus {
  return new ExtensionEventBus();
}
