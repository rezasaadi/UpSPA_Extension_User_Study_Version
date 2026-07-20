import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  loadMasterPasswordFromSession,
  rememberMasterPasswordForSession,
  SESSION_TTL_MS,
} from './session';

type Store = Record<string, unknown>;

function storageArea(store: Store): chrome.storage.StorageArea {
  return {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Store) => Object.assign(store, items)),
    remove: vi.fn(async (key: string) => { delete store[key]; }),
  } as unknown as chrome.storage.StorageArea;
}

describe('ephemeral master-password session', () => {
  let localStore: Store;
  let sessionStore: Store;

  beforeEach(() => {
    localStore = {};
    sessionStore = {};
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: storageArea(localStore),
          session: storageArea(sessionStore),
        },
      },
    });
  });

  it('keeps the master password only in extension session storage and slides its expiry', async () => {
    await rememberMasterPasswordForSession('master-secret', 1_000);

    expect(JSON.stringify(localStore)).not.toContain('master-secret');
    expect(JSON.stringify(sessionStore)).toContain('master-secret');
    await expect(loadMasterPasswordFromSession(2_000)).resolves.toBe('master-secret');
    await expect(loadMasterPasswordFromSession(2_000 + SESSION_TTL_MS - 1)).resolves.toBe('master-secret');
  });

  it('removes expired material and clears it when the session is locked', async () => {
    await rememberMasterPasswordForSession('expires', 10);
    await expect(loadMasterPasswordFromSession(10 + SESSION_TTL_MS)).resolves.toBeUndefined();
    expect(JSON.stringify(sessionStore)).not.toContain('expires');

    await rememberMasterPasswordForSession('lock-me', 20);
    await clearSession();
    expect(JSON.stringify(sessionStore)).not.toContain('lock-me');
  });
});
