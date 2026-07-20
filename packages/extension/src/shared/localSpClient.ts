import type { CtBlobB64, SetupSpPayload, StorageProviderClient, ToprfPartial } from 'upspa-js';

type LocalSetupRecord = {
  sig_pk_b64: string;
  cid: CtBlobB64;
  k_i_b64: string;
  updatedAt: number;
};

type LocalSpState = {
  setups: Record<string, LocalSetupRecord>;
  records: Record<string, CtBlobB64>;
};

const LOCAL_SP_STORAGE_KEY = 'upspa_local_sp_v1';

function utf8ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const globalValue = globalThis as typeof globalThis & { Buffer?: { from: (input: Uint8Array) => { toString: (encoding: string) => string } } };
  if (globalValue.Buffer) {
    return globalValue.Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function emptyState(): LocalSpState {
  return { setups: {}, records: {} };
}

async function readState(): Promise<LocalSpState> {
  const out = await chrome.storage.local.get(LOCAL_SP_STORAGE_KEY);
  const state = out[LOCAL_SP_STORAGE_KEY] as LocalSpState | undefined;
  return {
    ...emptyState(),
    ...(state ?? {}),
    setups: { ...(state?.setups ?? {}) },
    records: { ...(state?.records ?? {}) },
  };
}

async function writeState(state: LocalSpState): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_SP_STORAGE_KEY]: state });
}

export async function hasLocalStorageProviderSetup(uid: string): Promise<boolean> {
  const uidB64 = utf8ToBase64Url(uid);
  const state = await readState();
  return Boolean(state.setups[uidB64]);
}

export async function clearLocalStorageProviderState(): Promise<void> {
  await chrome.storage.local.remove(LOCAL_SP_STORAGE_KEY);
}

export async function readLocalStorageProviderStateForTests(): Promise<LocalSpState> {
  return readState();
}

export class LocalStorageProviderClient implements StorageProviderClient {
  readonly id: number;
  readonly baseUrl: string;

  constructor(id = 1) {
    this.id = id;
    this.baseUrl = `local://sp-${id}`;
  }

  async health(): Promise<void> {
    await readState();
  }

  async setup(payload: SetupSpPayload): Promise<void> {
    const state = await readState();
    state.setups[payload.uid] = {
      sig_pk_b64: payload.sig_pk,
      cid: payload.cid,
      k_i_b64: payload.k_i,
      updatedAt: Date.now(),
    };
    await writeState(state);
  }

  async getSetup(uid: string): Promise<{ sig_pk_b64: string; cid: CtBlobB64 }> {
    const uidB64 = utf8ToBase64Url(uid);
    const state = await readState();
    const setup = state.setups[uidB64];
    if (!setup) throw new Error(`Local SP setup not found for uid=${uid}`);
    return { sig_pk_b64: setup.sig_pk_b64, cid: setup.cid };
  }

  async toprfEval(uid: string, blinded_b64: string): Promise<ToprfPartial> {
    const uidB64 = utf8ToBase64Url(uid);
    const state = await readState();
    const setup = state.setups[uidB64];
    if (!setup) throw new Error(`Local SP TOPRF key share not found for uid=${uid}`);
    const { loadUpspaWasm } = await import('upspa-js');
    const wasm = await loadUpspaWasm();
    const y = wasm.toprf_server_eval_wasm(blinded_b64, setup.k_i_b64);
    return { id: this.id, y };
  }

  async createRecord(suid_b64: string, cj: CtBlobB64): Promise<void> {
    const state = await readState();
    if (state.records[suid_b64]) throw new Error(`Local SP record already exists: ${suid_b64}`);
    state.records[suid_b64] = cj;
    await writeState(state);
  }

  async getRecord(suid_b64: string): Promise<CtBlobB64> {
    const state = await readState();
    const record = state.records[suid_b64];
    if (!record) throw new Error(`Local SP record not found: ${suid_b64}`);
    return record;
  }

  async updateRecord(suid_b64: string, cj: CtBlobB64): Promise<void> {
    const state = await readState();
    state.records[suid_b64] = cj;
    await writeState(state);
  }

  async passwordUpdate(req: {
    uid: string;
    sp_id: number;
    timestamp: number;
    sig_b64: string;
    cid_new: CtBlobB64;
    k_i_new_b64: string;
  }): Promise<void> {
    const uidB64 = utf8ToBase64Url(req.uid);
    const state = await readState();
    const setup = state.setups[uidB64];
    if (!setup) throw new Error(`Local SP setup not found for uid=${req.uid}`);

    // Prototype relaxation: do not verify signature here. The final distributed/cloud mode
    // must keep server-side signature verification in the real SP.
    state.setups[uidB64] = {
      ...setup,
      cid: req.cid_new,
      k_i_b64: req.k_i_new_b64,
      updatedAt: Date.now(),
    };
    await writeState(state);
  }
}
