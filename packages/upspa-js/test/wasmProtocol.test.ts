import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import init, * as wasm from '../wasm-pkg/upspa_wasm.js';

beforeAll(async () => {
  const wasmBytes = await readFile(
    new URL('../wasm-pkg/upspa_wasm_bg.wasm', import.meta.url),
  );
  await init({ module_or_path: wasmBytes });
});

function createProtocolState(uid: string, masterPassword: string) {
  const setup = wasm.protocol_setup(uid, masterPassword, 3, 2);
  const begin = wasm.toprf_begin(masterPassword);
  const partials = setup.shares.slice(0, 2).map((share: { sp_id: number; k_i: string }) => ({
    id: share.sp_id,
    y: wasm.toprf_server_eval_wasm(begin.blinded, share.k_i),
  }));
  const stateKey = wasm.toprf_finish(masterPassword, begin.r, partials);
  return { setup, stateKey };
}

describe('real WASM credential envelopes', () => {
  it('keeps legacy registration in derived mode', () => {
    const uid = 'legacy-wasm-user';
    const lsj = 'https://legacy.example';
    const masterPassword = 'test master';
    const { setup, stateKey } = createProtocolState(uid, masterPassword);
    const registration = wasm.protocol_register(uid, lsj, stateKey, setup.cid, 3);
    const prepare = wasm.protocol_auth_prepare(uid, lsj, stateKey, setup.cid, 3);
    const auth = wasm.protocol_auth_finish(
      uid,
      lsj,
      prepare.k0,
      registration.per_sp.slice(0, 2).map((record: { cj: unknown }) => record.cj),
    );

    expect(auth).toMatchObject({
      credential_kind: 'derived',
      vinfo_prime: registration.to_ls.vinfo,
      best_ctr: 0,
    });
    expect(auth).not.toHaveProperty('website_password');
  });

  it('round-trips exact migrated and locally updated website passwords', () => {
    const uid = 'embedded-wasm-user';
    const lsj = 'https://embedded.example';
    const masterPassword = 'test master';
    const existingPassword = 'exact existing çığ 🔐 \0';
    const updatedPassword = 'exact later çığ 🔐 \0';
    const { setup, stateKey } = createProtocolState(uid, masterPassword);
    const migrated = wasm.protocol_migrate_existing(
      uid,
      lsj,
      stateKey,
      setup.cid,
      3,
      existingPassword,
    );
    expect(migrated.credential_kind).toBe('embedded_password');

    const prepare = wasm.protocol_auth_prepare(uid, lsj, stateKey, setup.cid, 3);
    const migratedCjs = migrated.per_sp
      .slice(0, 2)
      .map((record: { cj: unknown }) => record.cj);
    const firstAuth = wasm.protocol_auth_finish(uid, lsj, prepare.k0, migratedCjs);
    expect(firstAuth).toEqual({
      credential_kind: 'embedded_password',
      website_password: existingPassword,
      best_ctr: 0,
    });

    const updated = wasm.protocol_secret_update_finish(
      uid,
      lsj,
      prepare.k0,
      migratedCjs,
      updatedPassword,
    );
    expect(updated).toMatchObject({
      credential_kind: 'embedded_password',
      previous_credential_kind: 'embedded_password',
      old_ctr: 0,
      new_ctr: 1,
    });
    const secondAuth = wasm.protocol_auth_finish(uid, lsj, prepare.k0, [
      updated.cj_new,
      updated.cj_new,
    ]);
    expect(secondAuth).toEqual({
      credential_kind: 'embedded_password',
      website_password: updatedPassword,
      best_ctr: 1,
    });
  });
});
