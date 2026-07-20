import { createExtensionEventBus, type ExtensionEventBus } from '../shared/events/eventBus';
import { makeExtensionEvent, type ExtensionEvent, type PrototypeOperation, type PrototypeScreen } from '../shared/events/extensionEvents';

export type PopupEventControllerDeps = {
  setStatus: (message: string, kind?: 'normal' | 'error') => void;
  setBusy: (busy: boolean) => void;
  showScreen?: (screen: PrototypeScreen) => void;
  operations: Partial<Record<PrototypeOperation, () => Promise<string | void>>>;
};

export type PopupEventController = {
  bus: ExtensionEventBus;
  emit: (event: ExtensionEvent) => Promise<void>;
  requestRegistration: (origin: string, accountId: string) => Promise<void>;
  requestAuthentication: (origin: string, accountId: string) => Promise<void>;
  requestSecretUpdate: (origin: string, accountId: string) => Promise<void>;
  requestPasswordUpdate: () => Promise<void>;
};

async function runOperation(
  bus: ExtensionEventBus,
  deps: PopupEventControllerDeps,
  operation: PrototypeOperation,
  accountId?: string,
): Promise<void> {
  const action = deps.operations[operation];
  if (!action) {
    await bus.emit(makeExtensionEvent({
      type: 'OPERATION_FAILED',
      source: 'popup',
      operation,
      accountId,
      error: `No handler registered for ${operation}.`,
    }));
    return;
  }

  await bus.emit(makeExtensionEvent({ type: 'OPERATION_STARTED', source: 'popup', operation, accountId }));

  try {
    const message = await action();
    await bus.emit(makeExtensionEvent({
      type: 'OPERATION_SUCCESS',
      source: 'popup',
      operation,
      accountId,
      message: message || `${operation} completed.`,
    }));
  } catch (error) {
    await bus.emit(makeExtensionEvent({
      type: 'OPERATION_FAILED',
      source: 'popup',
      operation,
      accountId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export function createPopupEventController(deps: PopupEventControllerDeps): PopupEventController {
  const bus = createExtensionEventBus();

  bus.on('OPERATION_STARTED', (event) => {
    deps.setBusy(true);
    deps.setStatus(`Running ${event.operation}...`);
  });

  bus.on('OPERATION_SUCCESS', (event) => {
    deps.setBusy(false);
    deps.setStatus(event.message);
  });

  bus.on('OPERATION_FAILED', (event) => {
    deps.setBusy(false);
    deps.setStatus(event.error, 'error');
  });

  bus.on('POLICY_LOADED', (event) => {
    deps.setStatus(`Loaded prototype policy for ${event.label}.`);
  });

  bus.on('SCREEN_CHANGED', (event) => {
    deps.showScreen?.(event.screen);
  });

  bus.on('USER_REQUESTED_REGISTRATION', (event) =>
    runOperation(bus, deps, 'registration', event.accountId),
  );

  bus.on('USER_REQUESTED_AUTHENTICATION', (event) =>
    runOperation(bus, deps, 'authentication', event.accountId),
  );

  bus.on('USER_REQUESTED_SECRET_UPDATE', (event) =>
    runOperation(bus, deps, 'secret-update', event.accountId),
  );

  bus.on('USER_REQUESTED_PASSWORD_UPDATE', () =>
    runOperation(bus, deps, 'password-update'),
  );

  return {
    bus,
    emit: (event) => bus.emit(event),
    requestRegistration: (origin, accountId) =>
      bus.emit(makeExtensionEvent({ type: 'USER_REQUESTED_REGISTRATION', source: 'popup', origin, accountId })),
    requestAuthentication: (origin, accountId) =>
      bus.emit(makeExtensionEvent({ type: 'USER_REQUESTED_AUTHENTICATION', source: 'popup', origin, accountId })),
    requestSecretUpdate: (origin, accountId) =>
      bus.emit(makeExtensionEvent({ type: 'USER_REQUESTED_SECRET_UPDATE', source: 'popup', origin, accountId })),
    requestPasswordUpdate: () =>
      bus.emit(makeExtensionEvent({ type: 'USER_REQUESTED_PASSWORD_UPDATE', source: 'popup' })),
  };
}
