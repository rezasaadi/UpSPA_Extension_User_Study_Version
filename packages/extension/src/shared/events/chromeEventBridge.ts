import type { ExtensionEvent } from './extensionEvents';
import type { ExtensionEventBus, EventUnsubscribe } from './eventBus';

export const UPSPA_EXTENSION_EVENT_MESSAGE = 'UPSPA_EXTENSION_EVENT' as const;

export type RuntimeExtensionEventMessage = {
  type: typeof UPSPA_EXTENSION_EVENT_MESSAGE;
  event: ExtensionEvent;
};

export function isRuntimeExtensionEventMessage(input: unknown): input is RuntimeExtensionEventMessage {
  if (!input || typeof input !== 'object') return false;
  const maybe = input as { type?: unknown; event?: unknown };
  return maybe.type === UPSPA_EXTENSION_EVENT_MESSAGE && Boolean(maybe.event);
}

export async function publishChromeExtensionEvent(event: ExtensionEvent): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: UPSPA_EXTENSION_EVENT_MESSAGE, event });
  } catch {
    // Content scripts can run before the extension service worker is awake.
    // Event telemetry must never break autofill or UI behavior in the prototype.
  }
}

export function attachChromeEventBridge(bus: ExtensionEventBus): EventUnsubscribe {
  const listener = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    _sendResponse: (response?: unknown) => void,
  ): false => {
    if (isRuntimeExtensionEventMessage(message)) {
      void bus.emit(message.event);
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
