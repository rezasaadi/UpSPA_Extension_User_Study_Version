import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore Node types are not part of the extension tsconfig.
import { webcrypto } from 'node:crypto';
import {
  clearPendingSecretUpdateSession,
  loadPendingSecretUpdateSession,
  savePendingSecretUpdateSession,
} from '../src/shared/pendingSecretUpdate';
import { defaultPasswordPolicy } from '../src/shared/passwordPolicy';

type Store = Record<string, unknown>;
let store: Store;

function installEnvironment(): void {
  store = {};
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, 'btoa', { configurable: true, value: (input: string) => Buffer.from(input, 'binary').toString('base64') });
  Object.defineProperty(globalThis, 'atob', { configurable: true, value: (input: string) => Buffer.from(input, 'base64').toString('binary') });
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

describe('pending secret update recovery', () => {
  beforeEach(installEnvironment);

  it('keeps prepared commit material encrypted until the master password is supplied', async () => {
    await savePendingSecretUpdateSession(
      {
        version: 1,
        flowId: 'update-1',
        origin: 'https://github.com',
        accountId: 'alice',
        uid: 'uid-1',
        passwordPolicy: defaultPasswordPolicy(),
        encoderCounter: 1,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
      { version: 1, cjNew: { nonce: 'n', ct: 'ciphertext', tag: 't' }, suids: [{ sp_id: 1, suid: 'suid-1' }] },
      'master-password',
    );

    expect(JSON.stringify(store)).not.toContain('suid-1');
    const locked = await loadPendingSecretUpdateSession('https://github.com');
    expect(locked?.protectedMaterialLocked).toBe(true);
    expect(locked?.cjNew).toBeUndefined();
    const unlocked = await loadPendingSecretUpdateSession('https://github.com', 'master-password');
    expect(unlocked?.suids?.[0].suid).toBe('suid-1');
    await clearPendingSecretUpdateSession('update-1');
    await expect(loadPendingSecretUpdateSession()).resolves.toBeUndefined();
  });
});
