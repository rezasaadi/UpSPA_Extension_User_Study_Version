import { describe, expect, it, vi } from 'vitest';
import { createExtensionEventBus } from './eventBus';
import { makeExtensionEvent } from './extensionEvents';

describe('ExtensionEventBus', () => {
  it('delivers typed events only to matching listeners', async () => {
    const bus = createExtensionEventBus();
    const supported = vi.fn();
    const failed = vi.fn();

    bus.on('SUPPORTED_SITE_DETECTED', supported);
    bus.on('OPERATION_FAILED', failed);

    await bus.emit(makeExtensionEvent({
      type: 'SUPPORTED_SITE_DETECTED',
      source: 'popup',
      url: 'https://github.com/login',
      origin: 'https://github.com',
      host: 'github.com',
      siteId: 'github',
      label: 'GitHub',
    }));

    expect(supported).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('delivers all events to onAny and supports unsubscribe', async () => {
    const bus = createExtensionEventBus();
    const any = vi.fn();
    const unsubscribe = bus.onAny(any);

    await bus.emit(makeExtensionEvent({ type: 'SCREEN_CHANGED', source: 'popup', screen: 'sign-in' }));
    unsubscribe();
    await bus.emit(makeExtensionEvent({ type: 'SCREEN_CHANGED', source: 'popup', screen: 'create-account' }));

    expect(any).toHaveBeenCalledTimes(1);
  });

  it('emits operation failure events without throwing', async () => {
    const bus = createExtensionEventBus();

    await expect(bus.emit(makeExtensionEvent({
      type: 'OPERATION_FAILED',
      source: 'popup',
      operation: 'registration',
      error: 'boom',
    }))).resolves.toBeUndefined();
  });
});
