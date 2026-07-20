import type { CtBlobB64 } from 'upspa-js';
import type { DeterministicPasswordMetadata, PasswordPolicy } from './passwordPolicy';
import { decryptJson, encryptJson, type EncryptedJsonBlob } from './protectedStorage';

const STORAGE_KEY = 'upspa_pending_secret_update_v1';
const ENCRYPTION_PURPOSE = 'upspa-pending-secret-update-v1';
export const PENDING_SECRET_UPDATE_TTL_MS = 30 * 60 * 1000;

export type PendingSecretUpdateSession = {
  version: 1;
  flowId: string;
  origin: string;
  accountId: string;
  uid: string;
  passwordPolicy: PasswordPolicy;
  encoderCounter: number;
  passwordMetadata?: DeterministicPasswordMetadata;
  createdAt: number;
  expiresAt: number;
};

export type PendingSecretUpdateMaterial = {
  version: 1;
  cjNew: CtBlobB64;
  suids: Array<{ sp_id: number; suid: string }>;
};

export type PendingSecretUpdateWithMaterial = PendingSecretUpdateSession & {
  cjNew?: CtBlobB64;
  suids?: Array<{ sp_id: number; suid: string }>;
  protectedMaterialLocked?: boolean;
};

type StoredPendingSecretUpdate = {
  version: 1;
  session: PendingSecretUpdateSession;
  protectedMaterial: EncryptedJsonBlob;
};

function isFresh(session: PendingSecretUpdateSession): boolean {
  return session.expiresAt > Date.now();
}

export async function savePendingSecretUpdateSession(
  session: PendingSecretUpdateSession,
  material: PendingSecretUpdateMaterial,
  masterPassword: string,
): Promise<void> {
  const protectedMaterial = await encryptJson(masterPassword, material, ENCRYPTION_PURPOSE);
  const stored: StoredPendingSecretUpdate = { version: 1, session, protectedMaterial };
  await chrome.storage.local.set({
    [STORAGE_KEY]: stored,
  });
}

export async function loadPendingSecretUpdateSession(
  origin?: string,
  masterPassword?: string,
): Promise<PendingSecretUpdateWithMaterial | undefined> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as StoredPendingSecretUpdate | undefined;
  if (!stored || stored.version !== 1 || stored.session?.version !== 1) return undefined;
  if (!isFresh(stored.session)) {
    await clearPendingSecretUpdateSession(stored.session.flowId);
    return undefined;
  }
  if (origin && stored.session.origin !== origin) return undefined;

  if (!masterPassword) return { ...stored.session, protectedMaterialLocked: true };
  const material = await decryptJson<PendingSecretUpdateMaterial>(masterPassword, stored.protectedMaterial, ENCRYPTION_PURPOSE);
  return { ...stored.session, ...material };
}

export async function clearPendingSecretUpdateSession(flowId?: string): Promise<void> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as StoredPendingSecretUpdate | undefined;
  if (!stored || !flowId || stored.session.flowId === flowId) {
    await chrome.storage.local.remove(STORAGE_KEY);
  }
}
