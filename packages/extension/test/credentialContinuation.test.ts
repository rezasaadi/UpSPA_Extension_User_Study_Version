import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore Node types are not part of the extension tsconfig.
import { webcrypto } from 'node:crypto';
import {
  advanceCredentialContinuation,
  clearCredentialContinuation,
  loadCredentialContinuation,
  saveCredentialContinuation,
} from '../src/shared/credentialContinuation';

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

describe('credential continuation vault', () => {
  beforeEach(installEnvironment);

  it('encrypts a tab-bound stage-two credential and restores it after worker restart', async () => {
    await saveCredentialContinuation({
      flowId: 'flow-1',
      kind: 'authentication',
      siteId: 'github',
      tabId: 42,
      origin: 'https://github.com',
      material: {
        kind: 'authentication',
        accountId: 'alice@example.com',
        passwordForLs: 'website-password-secret',
      },
    });

    expect(JSON.stringify(store)).not.toContain('website-password-secret');
    await expect(loadCredentialContinuation(43, 'github')).resolves.toBeUndefined();
    await expect(loadCredentialContinuation(42, 'github')).resolves.toMatchObject({
      flowId: 'flow-1',
      expectedStage: 'identity-or-password',
      material: { accountId: 'alice@example.com', passwordForLs: 'website-password-secret' },
    });

    await expect(advanceCredentialContinuation(42, 'github', 'password', 'flow-1')).resolves.toBe(true);
    await expect(loadCredentialContinuation(42, 'github')).resolves.toMatchObject({
      expectedStage: 'password',
    });

    await clearCredentialContinuation(42, 'github', 'flow-1');
    await expect(loadCredentialContinuation(42, 'github')).resolves.toBeUndefined();
  });

  it('rejects local-only import and per-site secret-update continuations', async () => {
    await expect(saveCredentialContinuation({
      flowId: 'local-only',
      kind: 'import-existing-account',
      siteId: 'overleaf',
      tabId: 7,
      origin: 'https://www.overleaf.com',
      material: {
        kind: 'import-existing-account',
        oldPasswordForLs: 'existing-password',
        newPasswordForLs: 'replacement-password',
      },
    })).rejects.toThrow('local Cj operations');
    expect(JSON.stringify(store)).not.toContain('existing-password');
  });

  it('deletes deprecated website-change continuations without decrypting them', async () => {
    store.upspa_credential_continuations_v1 = {
      '9:github': {
        version: 1,
        flowId: 'old-flow',
        kind: 'website-password-update',
        expectedStage: 'password-change',
        siteId: 'github',
        tabId: 9,
        origin: 'https://github.com',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        protectedMaterial: { version: 1, salt: 'invalid', iv: 'invalid', ciphertext: 'invalid' },
      },
    };

    await expect(loadCredentialContinuation(9, 'github')).resolves.toBeUndefined();
    expect(store.upspa_credential_continuations_v1).toEqual({});
  });
});
