import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from './config';
import { isSetupComplete } from './setupState';

type Store = Record<string, unknown>;
let store: Store;

function installChromeStorage(): void {
  store = {};
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Store) => Object.assign(store, items)),
          remove: vi.fn(async (key: string) => { delete store[key]; }),
        },
      },
    },
  });
}

describe('setup state', () => {
  beforeEach(installChromeStorage);

  it('preserves an existing distributed configuration during setup-state migration', async () => {
    store.upspa_config = {
      enabled: true,
      uid: 'distributed-user',
      threshold: 2,
      sps: [
        { id: 1, baseUrl: 'https://sp-one.example' },
        { id: 2, baseUrl: 'https://sp-two.example' },
      ],
      storageMode: 'distributed',
    };

    await expect(isSetupComplete()).resolves.toBe(true);
    await expect(getConfig()).resolves.toMatchObject({
      uid: 'distributed-user',
      threshold: 2,
      storageMode: 'distributed',
    });
  });
});
