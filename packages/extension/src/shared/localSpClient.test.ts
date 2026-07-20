import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalStorageProviderClient,
  clearLocalStorageProviderState,
  readLocalStorageProviderStateForTests,
} from './localSpClient';

vi.mock('upspa-js', () => {
  const utf8ToBase64Url = (s: string) => btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return {
    utf8ToBase64Url,
    loadUpspaWasm: async () => ({
      toprf_server_eval_wasm: (blinded: string, share: string) => `eval:${blinded}:${share}`,
    }),
  };
});

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

const cid = { nonce: 'n', ct: 'c', tag: 't' };
const cid2 = { nonce: 'n2', ct: 'c2', tag: 't2' };
const aliceB64 = btoa('alice').replaceAll('=', '');

describe('LocalStorageProviderClient', () => {
  beforeEach(() => {
    installChromeStorage();
  });

  it('setup stores cid and TOPRF key share', async () => {
    const sp = new LocalStorageProviderClient(1);
    await sp.setup({ sp_id: 1, uid: aliceB64, sig_pk: 'sig', cid, k_i: 'share-1' });

    const state = await readLocalStorageProviderStateForTests();
    expect(state.setups[aliceB64]).toMatchObject({
      sig_pk_b64: 'sig',
      cid,
      k_i_b64: 'share-1',
    });
    await expect(sp.getSetup('alice')).resolves.toEqual({ sig_pk_b64: 'sig', cid });
    await expect(sp.toprfEval('alice', 'blind')).resolves.toEqual({ id: 1, y: 'eval:blind:share-1' });
  });

  it('record create, get, and update works', async () => {
    const sp = new LocalStorageProviderClient(1);
    await sp.createRecord('suid-1', cid);
    await expect(sp.createRecord('suid-1', cid)).rejects.toThrow(/already exists/);
    await expect(sp.getRecord('suid-1')).resolves.toEqual(cid);

    await sp.updateRecord('suid-1', cid2);
    await expect(sp.getRecord('suid-1')).resolves.toEqual(cid2);
  });

  it('passwordUpdate replaces cid and TOPRF key share', async () => {
    const sp = new LocalStorageProviderClient(1);
    await sp.setup({ sp_id: 1, uid: aliceB64, sig_pk: 'sig', cid, k_i: 'share-1' });

    await sp.passwordUpdate({
      uid: 'alice',
      sp_id: 1,
      timestamp: 1,
      sig_b64: 'sig-update',
      cid_new: cid2,
      k_i_new_b64: 'share-2',
    });

    await expect(sp.getSetup('alice')).resolves.toEqual({ sig_pk_b64: 'sig', cid: cid2 });
    await expect(sp.toprfEval('alice', 'blind')).resolves.toEqual({ id: 1, y: 'eval:blind:share-2' });
  });

  it('can clear local prototype state', async () => {
    const sp = new LocalStorageProviderClient(1);
    await sp.createRecord('suid-1', cid);
    await clearLocalStorageProviderState();

    await expect(sp.getRecord('suid-1')).rejects.toThrow(/not found/);
  });
});
