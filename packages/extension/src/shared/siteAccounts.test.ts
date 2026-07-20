import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPasswordPolicy } from './passwordPolicy';
import { getAccountForOrigin, upsertAccountForOrigin } from './siteAccounts';

const STORAGE_KEY = 'upspa_site_accounts';
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
        },
      },
    },
  });
}

describe('site account credential mode', () => {
  beforeEach(installChromeStorage);

  it('defaults legacy account metadata to derived credentials', async () => {
    store[STORAGE_KEY] = {
      'https://example.com': {
        accountId: 'legacy@example.com',
        passwordPolicy: defaultPasswordPolicy(),
        encoderCounter: 2,
      },
    };

    await expect(getAccountForOrigin('https://example.com', 'legacy@example.com')).resolves.toMatchObject({
      accountId: 'legacy@example.com',
      credentialMode: 'derived',
      passwordCounter: 2,
    });
  });

  it('stores only embedded-mode metadata and removes obsolete encoder state', async () => {
    await upsertAccountForOrigin('https://example.com', {
      accountId: 'alice@example.com',
      credentialMode: 'derived',
      passwordPolicy: defaultPasswordPolicy(),
      encoderCounter: 4,
      passwordCounter: 4,
      passwordMetadata: {
        version: 1,
        algorithm: 'upspa-hkdf-sha256-policy-v1',
        origin: 'https://example.com',
        uid: 'alice',
        suid: 'suid',
        counter: 4,
        policyHash: 'hash',
      },
    });
    await upsertAccountForOrigin('https://example.com', {
      accountId: 'alice@example.com',
      credentialMode: 'embedded-password',
    });

    const account = await getAccountForOrigin('https://example.com', 'alice@example.com');
    expect(account).toMatchObject({
      accountId: 'alice@example.com',
      credentialMode: 'embedded-password',
      passwordCounter: 0,
      encoderCounter: 0,
    });
    expect(account?.passwordPolicy).toBeUndefined();
    expect(account?.passwordMetadata).toBeUndefined();
    expect(JSON.stringify(store[STORAGE_KEY])).not.toContain('websitePassword');
  });
});
