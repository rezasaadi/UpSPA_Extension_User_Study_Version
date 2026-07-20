import { describe, expect, it, vi } from 'vitest';
import type { StorageProviderClient } from '../src/spClient.js';
import { UpspaClient } from '../src/upspaClient.js';
vi.mock('../src/wasm.js', async () => {
  return {
    loadUpspaWasm: async () => ({
      protocol_setup: (uid: string, password: string, nsp: number, tsp: number) => ({
        sig_pk: 'sigpk',
        cid: { nonce: 'n', ct: 'c', tag: 't' },
        shares: [],
        sp_payloads: Array.from({ length: nsp }, (_, i) => ({
          sp_id: i + 1,
          uid: 'uid',
          sig_pk: 'sigpk',
          cid: { nonce: 'n', ct: 'c', tag: 't' },
          k_i: 'k',
        })),
      }),
      toprf_begin: (password: string) => ({ r: 'r', blinded: `blinded(${password})` }),
      toprf_finish: (password: string, r: string, partials: unknown) => {
        const p = partials as Array<{ id: number; y: string }>;
        return `state_key(${password},${r},${p.map((x) => x.id).join(',')})`;
      },
      protocol_register: () => ({
        per_sp: [
          { sp_id: 1, suid: 'suid1', cj: { nonce: 'n', ct: 'c', tag: 't' } },
          { sp_id: 2, suid: 'suid2', cj: { nonce: 'n', ct: 'c', tag: 't' } },
        ],
        to_ls: { uid: 'uid', vinfo: 'vinfo' },
      }),
      protocol_migrate_existing: (
        _uid: string,
        _lsj: string,
        _stateKey: string,
        _cid: unknown,
        _nsp: number,
        websitePassword: string,
      ) => ({
        credential_kind: 'embedded_password',
        per_sp: [
          {
            sp_id: 1,
            suid: 'suid1',
            cj: { nonce: 'n', ct: `embedded(${websitePassword})`, tag: 't' },
          },
          {
            sp_id: 2,
            suid: 'suid2',
            cj: { nonce: 'n', ct: `embedded(${websitePassword})`, tag: 't' },
          },
        ],
      }),
      protocol_auth_prepare: () => ({
        k0: 'k0',
        per_sp: [
          { sp_id: 1, suid: 'suid1' },
          { sp_id: 2, suid: 'suid2' },
        ],
      }),
      protocol_auth_finish: () => ({
        credential_kind: 'derived',
        vinfo_prime: 'vinfo_prime',
        best_ctr: 0,
      }),
      protocol_secret_update_prepare: () => ({
        k0: 'k0',
        per_sp: [
          { sp_id: 1, suid: 'suid1' },
          { sp_id: 2, suid: 'suid2' },
        ],
      }),
      protocol_secret_update_finish: (
        _uid: string,
        _lsj: string,
        _k0: string,
        _cjs: unknown,
        websitePassword: string,
      ) => ({
        credential_kind: 'embedded_password',
        previous_credential_kind: 'derived',
        cj_new: { nonce: 'n2', ct: `updated(${websitePassword})`, tag: 't2' },
        old_ctr: 0,
        new_ctr: 1,
      }),
      protocol_password_update: () => ({
        cid_new: { nonce: 'n3', ct: 'c3', tag: 't3' },
        per_sp: [
          { sp_id: 1, sig: 'sig1', k_i_new: 'k1' },
          { sp_id: 2, sig: 'sig2', k_i_new: 'k2' },
        ],
      }),
    }),
  };
});
function mkSp(
  id: number,
  opts?: { failToprf?: boolean; failCid?: boolean; failCreateRecord?: boolean },
): StorageProviderClient {
  return {
    id,
    baseUrl: `https://sp${id}.example`,
    health: async () => undefined,
    setup: async () => undefined,
    getSetup: async () => {
      if (opts?.failCid) throw new Error('nope');
      return { sig_pk_b64: 'sigpk', cid: { nonce: 'n', ct: 'c', tag: 't' } };
    },
    toprfEval: async () => {
      if (opts?.failToprf) throw new Error('toprf fail');
      return { id, y: `y${id}` };
    },
    createRecord: async () => {
      if (opts?.failCreateRecord) throw new Error('create fail');
    },
    getRecord: async () => ({ nonce: 'n', ct: 'c', tag: 't' }),
    updateRecord: async () => undefined,
    passwordUpdate: async () => undefined,
  };
}
describe('UpspaClient (mocked wasm)', () => {
  it('derives state key with threshold partials', async () => {
    const client = new UpspaClient(
      {
        uid: 'alice',
        threshold: 2,
        sps: [
          { id: 1, baseUrl: 'https://sp1' },
          { id: 2, baseUrl: 'https://sp2' },
          { id: 3, baseUrl: 'https://sp3' },
        ],
      },
      [mkSp(1), mkSp(2), mkSp(3, { failToprf: true })],
    );
    const r = await client.deriveStateKey('pw');
    expect(r.state_key_b64).toContain('state_key(pw');
    expect(r.partials.length).toBe(2);
    expect(r.partials.map((p) => p.id)).toEqual([1, 2]);
  });
  it('fetches cid from first available SP', async () => {
    const client = new UpspaClient(
      {
        uid: 'alice',
        threshold: 2,
        sps: [
          { id: 1, baseUrl: 'https://sp1' },
          { id: 2, baseUrl: 'https://sp2' },
        ],
      },
      [mkSp(1, { failCid: true }), mkSp(2)],
    );
    const cid = await client.fetchCid();
    expect(cid.ct).toBe('c');
  });
  it('register returns vinfo and writes records', async () => {
    const sp1 = mkSp(1);
    const sp2 = mkSp(2);
    const createSpy1 = vi.spyOn(sp1, 'createRecord');
    const createSpy2 = vi.spyOn(sp2, 'createRecord');
    const client = new UpspaClient(
      {
        uid: 'alice',
        threshold: 2,
        sps: [
          { id: 1, baseUrl: 'https://sp1' },
          { id: 2, baseUrl: 'https://sp2' },
        ],
      },
      [sp1, sp2],
    );
    const out = await client.register('https://ls.example', 'pw');
    expect(out.to_ls.vinfo).toBe('vinfo');
    expect(createSpy1).toHaveBeenCalledTimes(1);
    expect(createSpy2).toHaveBeenCalledTimes(1);
  });

  it('prepareRegistration returns LS password and defers SP writes', async () => {
    const sp1 = mkSp(1);
    const sp2 = mkSp(2);
    const createSpy1 = vi.spyOn(sp1, 'createRecord');
    const createSpy2 = vi.spyOn(sp2, 'createRecord');
    const client = new UpspaClient(
      {
        uid: 'alice',
        threshold: 2,
        sps: [
          { id: 1, baseUrl: 'https://sp1' },
          { id: 2, baseUrl: 'https://sp2' },
        ],
      },
      [sp1, sp2],
    );

    const out = await client.prepareRegistration('https://ls.example', 'pw');

    expect(out.to_ls.vinfo).toBe('vinfo');
    expect(out.per_sp).toHaveLength(2);
    expect(createSpy1).not.toHaveBeenCalled();
    expect(createSpy2).not.toHaveBeenCalled();
  });

  it('applyRegistrationToSPs requires the configured write threshold', async () => {
    const client = new UpspaClient(
      {
        uid: 'alice',
        threshold: 2,
        sps: [
          { id: 1, baseUrl: 'https://sp1' },
          { id: 2, baseUrl: 'https://sp2' },
        ],
      },
      [mkSp(1), mkSp(2, { failCreateRecord: true })],
    );

    await expect(
      client.applyRegistrationToSPs([
        { sp_id: 1, suid: 'suid1', cj: { nonce: 'n', ct: 'c', tag: 't' } },
        { sp_id: 2, suid: 'suid2', cj: { nonce: 'n', ct: 'c', tag: 't' } },
      ]),
    ).rejects.toThrow(/only 1\/2 succeeded/);
  });

  it('prepares migration with the exact existing website password and no writes', async () => {
    const sp1 = mkSp(1);
    const sp2 = mkSp(2);
    const createSpy1 = vi.spyOn(sp1, 'createRecord');
    const createSpy2 = vi.spyOn(sp2, 'createRecord');
    const client = new UpspaClient(
      {
        uid: 'alice',
        threshold: 2,
        sps: [
          { id: 1, baseUrl: 'https://sp1' },
          { id: 2, baseUrl: 'https://sp2' },
        ],
      },
      [sp1, sp2],
    );

    const out = await client.prepareMigration(
      'https://ls.example',
      'master password',
      'exact website pässword',
    );

    expect(out.credential_kind).toBe('embedded_password');
    expect(out.per_sp[0].cj.ct).toBe('embedded(exact website pässword)');
    expect(createSpy1).not.toHaveBeenCalled();
    expect(createSpy2).not.toHaveBeenCalled();
  });

  it('migrates existing records through the normal SP commit path', async () => {
    const sp1 = mkSp(1);
    const sp2 = mkSp(2);
    const createSpy1 = vi.spyOn(sp1, 'createRecord');
    const createSpy2 = vi.spyOn(sp2, 'createRecord');
    const client = new UpspaClient(
      {
        uid: 'alice',
        threshold: 2,
        sps: [
          { id: 1, baseUrl: 'https://sp1' },
          { id: 2, baseUrl: 'https://sp2' },
        ],
      },
      [sp1, sp2],
    );

    await client.migrateExisting('https://ls.example', 'master', 'site-password');

    expect(createSpy1).toHaveBeenCalledWith('suid1', {
      nonce: 'n',
      ct: 'embedded(site-password)',
      tag: 't',
    });
    expect(createSpy2).toHaveBeenCalledTimes(1);
  });

  it('returns discriminated authentication material for legacy registration', async () => {
    const client = new UpspaClient(
      {
        uid: 'alice',
        threshold: 1,
        sps: [
          { id: 1, baseUrl: 'https://sp1' },
          { id: 2, baseUrl: 'https://sp2' },
        ],
      },
      [mkSp(1), mkSp(2)],
    );

    const out = await client.authenticate('https://ls.example', 'master');

    expect(out).toEqual({
      credential_kind: 'derived',
      vinfo_prime: 'vinfo_prime',
      best_ctr: 0,
    });
  });

  it('embeds the entered website password during local secret update preparation', async () => {
    const client = new UpspaClient(
      {
        uid: 'alice',
        threshold: 1,
        sps: [
          { id: 1, baseUrl: 'https://sp1' },
          { id: 2, baseUrl: 'https://sp2' },
        ],
      },
      [mkSp(1), mkSp(2)],
    );

    const out = await client.secretUpdate(
      'https://ls.example',
      'master',
      'current website password',
    );

    expect(out.credential_kind).toBe('embedded_password');
    expect(out.previous_credential_kind).toBe('derived');
    expect(out.cj_new.ct).toBe('updated(current website password)');
    expect(out.suids).toEqual([
      { sp_id: 1, suid: 'suid1' },
      { sp_id: 2, suid: 'suid2' },
    ]);
  });
});
