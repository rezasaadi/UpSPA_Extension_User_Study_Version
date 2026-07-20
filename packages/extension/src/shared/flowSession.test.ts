import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFlowSession,
  loadFlowSession,
  restoreFlowSession,
  saveFlowSession,
  updateFlowSession,
} from './flowSession';

type Store = Record<string, unknown>;
let sessionStore: Store;

function installChromeSessionStorage(): void {
  sessionStore = {};
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: sessionStore[key] })),
          set: vi.fn(async (items: Store) => Object.assign(sessionStore, items)),
          remove: vi.fn(async (key: string) => { delete sessionStore[key]; }),
        },
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
      },
    },
  });
}

describe('FlowSession', () => {
  beforeEach(() => installChromeSessionStorage());

  it('persists only orchestration metadata and restores it for the same tab and site', async () => {
    const flow = await saveFlowSession({
      kind: 'website-signin',
      siteId: 'github',
      accountId: 'alice@example.com',
      stage: 'waiting-for-password',
      pageKind: 'login',
      tabId: 42,
      pendingOperationId: 'operation-1',
    });

    expect(JSON.stringify(sessionStore)).not.toContain('master-password');
    await expect(restoreFlowSession({ siteId: 'github', tabId: 42 })).resolves.toMatchObject({ flowId: flow.flowId, accountId: 'alice@example.com' });
    await expect(restoreFlowSession({ siteId: 'github', tabId: 43 })).resolves.toBeUndefined();
  });

  it('updates stage and clears the active flow', async () => {
    await saveFlowSession({ kind: 'website-password-update', siteId: 'github', stage: 'password-settings' });
    await expect(updateFlowSession({ stage: 'waiting-confirmation' })).resolves.toMatchObject({ stage: 'waiting-confirmation' });
    await clearFlowSession();
    await expect(loadFlowSession()).resolves.toBeUndefined();
  });
});
