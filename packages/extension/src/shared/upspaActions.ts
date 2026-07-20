import { UpspaClient, type CtBlobB64, type RegistrationSpOut } from 'upspa-js';
import {
  getConfig,
  localPrototypeConfig,
  setConfig,
  type UpspaConfig,
  type SpConfig,
} from './config';
import { LocalStorageProviderClient } from './localSpClient';
export type PreparedSecretUpdate = {
  uid: string;
  previousCredentialKind: 'derived' | 'embedded-password';
  cjNew: CtBlobB64;
  oldCounter: number;
  newCounter: number;
  suids: Array<{ sp_id: number; suid: string }>;
};
export type PreparedMigration = {
  uid: string;
  records: RegistrationSpOut[];
};
export type RecoveredSiteCredential =
  | { kind: 'derived'; secretForLs: string; counter: number }
  | { kind: 'embedded-password'; password: string; counter: number };
export type PreparedRegistration = {
  uid: string;
  passwordForLs: string;
  records: RegistrationSpOut[];
};
function requireConfig(cfg: UpspaConfig): Required<UpspaConfig> {
  if (!cfg.enabled) throw new Error('UpSPA is disabled.');
  if (!cfg.uid) throw new Error('UpSPA uid is empty. Open extension options.');
  if (!cfg.sps || cfg.sps.length === 0) throw new Error('No Storage Providers configured.');
  if (!cfg.threshold || cfg.threshold < 1 || cfg.threshold > cfg.sps.length) {
    throw new Error('Invalid threshold.');
  }
  return cfg as Required<UpspaConfig>;
}
function resolveClientUid(cfg: Required<UpspaConfig>, uidOverride?: string): string {
  const uid = (uidOverride ?? cfg.uid).trim();
  if (!uid) throw new Error('UpSPA uid is empty.');
  return uid;
}
function validateSetupInput(input: {
  uid: string;
  password: string;
  threshold: number;
  sps: SpConfig[];
  storageMode?: UpspaConfig['storageMode'];
}): void {
  if (!input.uid.trim()) throw new Error('UID is empty.');
  if (!input.password) throw new Error('Password is empty.');
  if (input.storageMode === 'local-prototype') return;
  if (!input.sps || input.sps.length === 0) throw new Error('No Storage Providers configured.');
  if (!Number.isInteger(input.threshold) || input.threshold < 1 || input.threshold > input.sps.length) {
    throw new Error('Invalid threshold.');
  }
}
export async function makeUpspaClient(uidOverride?: string): Promise<UpspaClient> {
  const cfg = requireConfig(await getConfig());
  const uid = resolveClientUid(cfg, uidOverride);

  if (cfg.storageMode === 'local-prototype') {
    const client = new UpspaClient(
      {
        uid,
        threshold: 1,
        sps: [{ id: 1, baseUrl: 'local://sp-1' }],
      },
      [new LocalStorageProviderClient(1)],
    );
    await client.init();
    return client;
  }

  const client = new UpspaClient({ uid, threshold: cfg.threshold, sps: cfg.sps });
  await client.init();
  return client;
}
export async function saveDemoConfig(input: {
  uid: string;
  threshold: number;
  sps: SpConfig[];
  storageMode?: UpspaConfig['storageMode'];
}): Promise<void> {
  if (!input.uid.trim()) throw new Error('UID is empty.');
  if ((input.storageMode ?? 'local-prototype') === 'local-prototype') {
    await setConfig(localPrototypeConfig(input.uid));
    return;
  }
  if (!input.sps || input.sps.length === 0) throw new Error('No Storage Providers configured.');
  if (!Number.isInteger(input.threshold) || input.threshold < 1 || input.threshold > input.sps.length) {
    throw new Error('Invalid threshold.');
  }
  await setConfig({
    enabled: true,
    uid: input.uid.trim(),
    threshold: input.threshold,
    sps: input.sps,
    storageMode: 'distributed',
  });
}
export async function setupAndProvision(input: {
  uid: string;
  password: string;
  threshold: number;
  sps: SpConfig[];
  storageMode?: UpspaConfig['storageMode'];
}): Promise<void> {
  const storageMode = input.storageMode ?? 'local-prototype';
  validateSetupInput({ ...input, storageMode });
  const uid = input.uid.trim();
  await saveDemoConfig({
    uid,
    threshold: storageMode === 'local-prototype' ? 1 : input.threshold,
    sps: storageMode === 'local-prototype' ? [{ id: 1, baseUrl: 'local://sp-1' }] : input.sps,
    storageMode,
  });
  const client =
    storageMode === 'local-prototype'
      ? new UpspaClient(
          {
            uid,
            threshold: 1,
            sps: [{ id: 1, baseUrl: 'local://sp-1' }],
          },
          [new LocalStorageProviderClient(1)],
        )
      : new UpspaClient({
          uid,
          threshold: input.threshold,
          sps: input.sps,
        });
  await client.init();
  await client.setupAndProvision(input.password, storageMode === 'local-prototype' ? 1 : input.threshold);
}
export async function registerForSite(lsj: string, password: string, uid?: string): Promise<string> {
  const client = await makeUpspaClient(uid);
  const out = await client.register(lsj, password);
  return out.to_ls.vinfo;
}
export async function prepareRegistrationForSite(
  lsj: string,
  password: string,
  uid?: string,
): Promise<PreparedRegistration> {
  const client = await makeUpspaClient(uid);
  const out = await client.prepareRegistration(lsj, password);

  return {
    uid: client.uid,
    passwordForLs: out.to_ls.vinfo,
    records: out.per_sp,
  };
}

export async function commitRegistrationForSite(
  prepared: Pick<PreparedRegistration, 'uid' | 'records'>,
): Promise<void> {
  const client = await makeUpspaClient(prepared.uid);
  await client.applyRegistrationToSPs(prepared.records);
}
export async function prepareMigrationForSite(
  lsj: string,
  masterPassword: string,
  websitePassword: string,
  uid?: string,
): Promise<PreparedMigration> {
  if (!masterPassword) throw new Error('Master password is empty.');
  if (!websitePassword) throw new Error('Website password is empty.');
  const client = await makeUpspaClient(uid);
  const out = await client.prepareMigration(lsj, masterPassword, websitePassword);
  return { uid: client.uid, records: out.per_sp };
}

export async function commitMigrationForSite(prepared: PreparedMigration): Promise<void> {
  const client = await makeUpspaClient(prepared.uid);
  await client.applyMigrationToSPs(prepared.records);
}

export async function authenticateForSite(
  lsj: string,
  password: string,
  uid?: string,
): Promise<RecoveredSiteCredential> {
  const client = await makeUpspaClient(uid);
  const out = await client.authenticate(lsj, password);
  if (out.credential_kind === 'embedded_password') {
    return { kind: 'embedded-password', password: out.website_password, counter: out.best_ctr };
  }
  return { kind: 'derived', secretForLs: out.vinfo_prime, counter: out.best_ctr };
}
export async function prepareSecretUpdateForSite(
  lsj: string,
  masterPassword: string,
  websitePassword: string,
  uid?: string,
): Promise<PreparedSecretUpdate> {
  if (!masterPassword) throw new Error('Master password is empty.');
  if (!websitePassword) throw new Error('Website password is empty.');
  const client = await makeUpspaClient(uid);
  const out = await client.secretUpdate(lsj, masterPassword, websitePassword);
  return {
    uid: client.uid,
    previousCredentialKind: out.previous_credential_kind === 'embedded_password'
      ? 'embedded-password'
      : 'derived',
    cjNew: out.cj_new,
    oldCounter: out.old_ctr,
    newCounter: out.new_ctr,
    suids: out.suids,
  };
}

export async function commitSecretUpdateForSite(
  prepared: Pick<PreparedSecretUpdate, 'uid' | 'cjNew' | 'suids'>,
): Promise<void> {
  const client = await makeUpspaClient(prepared.uid);
  await client.applySecretUpdateToSPs(prepared.suids, prepared.cjNew);
}
export async function secretUpdateForSite(
  lsj: string,
  masterPassword: string,
  websitePassword: string,
  uid?: string,
): Promise<{ previousCredentialKind: PreparedSecretUpdate['previousCredentialKind']; counter: number }> {
  const prepared = await prepareSecretUpdateForSite(lsj, masterPassword, websitePassword, uid);
  return { previousCredentialKind: prepared.previousCredentialKind, counter: prepared.newCounter };
}
export async function passwordUpdateDirect(
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  if (!oldPassword) throw new Error('Old password is empty.');
  if (!newPassword) throw new Error('New password is empty.');
  const client = await makeUpspaClient();
  const timestamp = Math.floor(Date.now() / 1000);
  await client.passwordUpdate(oldPassword, newPassword, timestamp);
}
