import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore Node types are not part of the extension tsconfig.
import { webcrypto } from 'node:crypto';
import {
  clearPendingRegistrationSession,
  createPendingRegistrationSession,
  loadPendingRegistrationSession,
  PENDING_REGISTRATION_TTL_MS,
  savePendingRegistrationSession,
} from '../src/shared/pendingRegistration';
import { defaultPasswordPolicy } from '../src/shared/passwordPolicy';

const KEY = 'upspa_pending_registration_sessions';

type Store = Record<string, unknown>;

let store: Store;

function installWebCrypto(): void {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  Object.defineProperty(globalThis, 'btoa', {
    configurable: true,
    value: (input: string) => Buffer.from(input, 'binary').toString('base64'),
  });
  Object.defineProperty(globalThis, 'atob', {
    configurable: true,
    value: (input: string) => Buffer.from(input, 'base64').toString('binary'),
  });
}

function installChromeLocalStorage(): void {
  store = {};

  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Store) => {
            Object.assign(store, items);
          }),
          remove: vi.fn(async (key: string) => {
            delete store[key];
          }),
        },
      },
    },
  });
}

function makeSession() {
  return createPendingRegistrationSession({
    flowId: 'flow-1',
    origin: 'https://login.example',
    websiteURL: 'https://login.example/register',
    uid: 'main-upspa-uid',
    suid: 'suid1',
    username: 'alice',
    passwordPolicy: defaultPasswordPolicy(),
    counter: 4,
    confirmationNonce: 'nonce-1',
  });
}

describe('pending registration recovery', () => {
  beforeEach(() => {
    vi.useRealTimers();
    installWebCrypto();
    installChromeLocalStorage();
  });

  it('persists metadata in local storage and keeps protected material encrypted', async () => {
    const session = makeSession();
    await savePendingRegistrationSession(
      session,
      {
        version: 1,
        passwordForLs: 'vinfo-secret',
        records: [
          {
            sp_id: 1,
            suid: 'suid1',
            cj: { nonce: 'n', ct: 'c', tag: 't' },
          },
        ],
      },
      'master-password',
    );

    const rawStore = store[KEY] as Record<string, { session: unknown; protectedMaterial: { ciphertext: string } }>;
    expect(rawStore['flow-1'].session).toMatchObject({
      flowId: 'flow-1',
      origin: 'https://login.example',
      username: 'alice',
      counter: 4,
    });
    expect(JSON.stringify(rawStore)).not.toContain('vinfo-secret');

    const locked = await loadPendingRegistrationSession('https://login.example');
    expect(locked?.protectedMaterialLocked).toBe(true);
    expect(locked?.records).toBeUndefined();

    const unlocked = await loadPendingRegistrationSession('https://login.example', 'master-password');
    expect(unlocked?.passwordForLs).toBe('vinfo-secret');
    expect(unlocked?.records?.[0].suid).toBe('suid1');
  });

  it('expires stale pending registration records', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-05T00:00:00Z'));

    await savePendingRegistrationSession(makeSession());

    vi.advanceTimersByTime(PENDING_REGISTRATION_TTL_MS + 1);

    await expect(loadPendingRegistrationSession('https://login.example')).resolves.toBeUndefined();
    expect(store[KEY]).toEqual({});
  });

  it('clears a pending registration by flow id', async () => {
    await savePendingRegistrationSession(makeSession());

    await clearPendingRegistrationSession('flow-1');

    expect(await loadPendingRegistrationSession('flow-1')).toBeUndefined();
    expect(store[KEY]).toEqual({});
  });
});
