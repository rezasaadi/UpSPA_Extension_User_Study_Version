import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '../src/shared/config';
import { hasLocalStorageProviderSetup, readLocalStorageProviderStateForTests } from '../src/shared/localSpClient';
import {
  authenticateForSite,
  commitRegistrationForSite,
  commitMigrationForSite,
  commitSecretUpdateForSite,
  passwordUpdateDirect,
  prepareMigrationForSite,
  prepareRegistrationForSite,
  prepareSecretUpdateForSite,
  setupAndProvision,
} from '../src/shared/upspaActions';

const cidOld = { nonce: 'n1', ct: 'cid-old', tag: 't1' };
const cidNew = { nonce: 'n2', ct: 'cid-new', tag: 't2' };
const cjOld = { nonce: 'n3', ct: 'cj-old', tag: 't3' };
const cjNew = { nonce: 'n4', ct: 'cj-new', tag: 't4' };
const cjMigrated = { nonce: 'n5', ct: 'cj-migrated', tag: 't5' };

vi.mock('upspa-js', () => {
  const utf8ToBase64Url = (s: string) => btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  class UpspaClient {
    uid: string;
    threshold: number;
    sps: any[];

    constructor(cfg: { uid: string; threshold: number }, spClients: any[] = []) {
      this.uid = cfg.uid;
      this.threshold = cfg.threshold;
      this.sps = spClients;
    }

    async init(): Promise<void> {}

    async setupAndProvision(): Promise<void> {
      await this.sps[0].setup({
        sp_id: 1,
        uid: utf8ToBase64Url(this.uid),
        sig_pk: 'sig',
        cid: cidOld,
        k_i: 'share-old',
      });
    }

    async prepareRegistration(lsj: string): Promise<any> {
      return {
        to_ls: { uid: this.uid, vinfo: `vinfo:${lsj}` },
        per_sp: [{ sp_id: 1, suid: `suid:${lsj}`, cj: cjOld }],
      };
    }

    async applyRegistrationToSPs(records: Array<{ sp_id: number; suid: string; cj: unknown }>): Promise<void> {
      await Promise.all(records.map((record) => this.sps[0].createRecord(record.suid, record.cj)));
    }

    async prepareMigration(lsj: string, _masterPassword: string, websitePassword: string): Promise<any> {
      expect(websitePassword).toBe('existing-site-password');
      return { per_sp: [{ sp_id: 1, suid: `suid:${lsj}`, cj: cjMigrated }] };
    }

    async applyMigrationToSPs(records: Array<{ sp_id: number; suid: string; cj: unknown }>): Promise<void> {
      await Promise.all(records.map((record) => this.sps[0].createRecord(record.suid, record.cj)));
    }

    async authenticate(lsj: string): Promise<any> {
      const record = await this.sps[0].getRecord(`suid:${lsj}`);
      if (record.ct === cjMigrated.ct) {
        return { credential_kind: 'embedded_password', website_password: 'existing-site-password', best_ctr: 0 };
      }
      if (record.ct === cjNew.ct) {
        return { credential_kind: 'embedded_password', website_password: 'current-site-password', best_ctr: 1 };
      }
      return { credential_kind: 'derived', vinfo_prime: `auth:${lsj}`, best_ctr: 0 };
    }

    async secretUpdate(lsj: string, _masterPassword: string, websitePassword: string): Promise<any> {
      expect(websitePassword).toBe('current-site-password');
      await this.sps[0].getRecord(`suid:${lsj}`);
      return {
        credential_kind: 'embedded_password',
        previous_credential_kind: 'derived',
        cj_new: cjNew,
        old_ctr: 0,
        new_ctr: 1,
        suids: [{ sp_id: 1, suid: `suid:${lsj}` }],
      };
    }

    async applySecretUpdateToSPs(suids: Array<{ suid: string }>, cj: unknown): Promise<void> {
      await Promise.all(suids.map((record) => this.sps[0].updateRecord(record.suid, cj)));
    }

    async passwordUpdate(_oldPassword: string, _newPassword: string, timestamp: number): Promise<any> {
      await this.sps[0].passwordUpdate({
        uid: this.uid,
        sp_id: 1,
        timestamp,
        sig_b64: 'sig-update',
        cid_new: cidNew,
        k_i_new_b64: 'share-new',
      });
      return { cid_new: cidNew, per_sp: [{ sp_id: 1, sig: 'sig-update', k_i_new: 'share-new' }] };
    }
  }

  return {
    UpspaClient,
    utf8ToBase64Url,
    loadUpspaWasm: async () => ({ toprf_server_eval_wasm: () => 'eval' }),
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

describe('local prototype flow', () => {
  beforeEach(() => {
    installChromeStorage();
  });

  it('runs setup, register, auth, secret update, and password update against one local SP', async () => {
    await setupAndProvision({
      uid: 'alice',
      password: 'old-master',
      threshold: 3,
      sps: [],
      storageMode: 'local-prototype',
    });

    await expect(hasLocalStorageProviderSetup('alice')).resolves.toBe(true);
    await expect(getConfig()).resolves.toMatchObject({
      uid: 'alice',
      threshold: 1,
      sps: [{ id: 1, baseUrl: 'local://sp-1' }],
      storageMode: 'local-prototype',
    });

    const lsj = 'https://github.com|alice@example.com';
    const preparedRegistration = await prepareRegistrationForSite(lsj, 'old-master');
    await commitRegistrationForSite(preparedRegistration);
    await expect(authenticateForSite(lsj, 'old-master')).resolves.toEqual({
      kind: 'derived',
      secretForLs: `auth:${lsj}`,
      counter: 0,
    });

    const preparedUpdate = await prepareSecretUpdateForSite(lsj, 'old-master', 'current-site-password');
    expect(preparedUpdate.previousCredentialKind).toBe('derived');
    await commitSecretUpdateForSite(preparedUpdate);
    let state = await readLocalStorageProviderStateForTests();
    expect(state.records[`suid:${lsj}`]).toEqual(cjNew);
    await expect(authenticateForSite(lsj, 'old-master')).resolves.toEqual({
      kind: 'embedded-password',
      password: 'current-site-password',
      counter: 1,
    });

    const migratedLsj = 'https://overleaf.com|existing@example.com';
    const preparedMigration = await prepareMigrationForSite(
      migratedLsj,
      'old-master',
      'existing-site-password',
    );
    await commitMigrationForSite(preparedMigration);
    await expect(authenticateForSite(migratedLsj, 'old-master')).resolves.toEqual({
      kind: 'embedded-password',
      password: 'existing-site-password',
      counter: 0,
    });

    await passwordUpdateDirect('old-master', 'new-master');
    state = await readLocalStorageProviderStateForTests();
    const setup = Object.values(state.setups)[0];
    expect(setup.cid).toEqual(cidNew);
    expect(setup.k_i_b64).toBe('share-new');
  });
});
