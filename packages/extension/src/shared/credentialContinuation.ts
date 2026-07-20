import { decryptJson, encryptJson, type EncryptedJsonBlob } from './protectedStorage';

const STORAGE_KEY = 'upspa_credential_continuations_v1';
const VAULT_KEY = 'upspa_credential_continuation_vault_key_v1';
const ENCRYPTION_PURPOSE = 'upspa-credential-continuation-v1';
export const CREDENTIAL_CONTINUATION_TTL_MS = 30 * 60 * 1000;

export type CredentialContinuationKind =
  | 'authentication'
  | 'registration'
  | 'import-existing-account'
  | 'website-password-update';

export type CredentialContinuationExpectedStage =
  | 'identity-or-password'
  | 'password'
  | 'password-change'
  | 'new-password';

export type CredentialContinuationMaterial =
  | {
      kind: 'authentication';
      accountId: string;
      uid?: string;
      passwordForLs: string;
    }
  | {
      kind: 'registration';
      accountId: string;
      uid?: string;
      passwordForLs: string;
      flowId?: string;
      origin?: string;
      confirmationNonce?: string;
    }
  | {
      kind: 'import-existing-account' | 'website-password-update';
      oldPasswordForLs: string;
      newPasswordForLs: string;
    };

export type CredentialContinuation = {
  version: 1;
  flowId?: string;
  kind: CredentialContinuationKind;
  expectedStage: CredentialContinuationExpectedStage;
  siteId: string;
  tabId: number;
  origin: string;
  createdAt: number;
  expiresAt: number;
  material: CredentialContinuationMaterial;
};

export type CredentialContinuationInput = Omit<
  CredentialContinuation,
  'version' | 'createdAt' | 'expiresAt' | 'expectedStage'
> & {
  expectedStage?: CredentialContinuationExpectedStage;
  createdAt?: number;
  expiresAt?: number;
};

type StoredCredentialContinuation = {
  version: 1;
  flowId?: string;
  kind: CredentialContinuationKind;
  expectedStage: CredentialContinuationExpectedStage;
  siteId: string;
  tabId: number;
  origin: string;
  createdAt: number;
  expiresAt: number;
  protectedMaterial: EncryptedJsonBlob;
};

type ContinuationStore = Record<string, StoredCredentialContinuation>;

function defaultExpectedStage(kind: CredentialContinuationKind): CredentialContinuationExpectedStage {
  return kind === 'authentication' || kind === 'registration'
    ? 'identity-or-password'
    : 'password-change';
}

function recordKey(tabId: number, siteId: string): string {
  return `${tabId}:${siteId}`;
}

function randomVaultPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getVaultPassword(): Promise<string> {
  const storage = chrome.storage as typeof chrome.storage & { session?: chrome.storage.StorageArea };
  const keyArea = storage.session ?? chrome.storage.local;
  const stored = await keyArea.get(VAULT_KEY);
  const existing = stored[VAULT_KEY];
  if (typeof existing === 'string' && existing.length >= 64) return existing;
  const created = randomVaultPassword();
  await keyArea.set({ [VAULT_KEY]: created });
  return created;
}

async function readStore(): Promise<ContinuationStore> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as ContinuationStore | undefined) ?? {};
}

async function writeStore(store: ContinuationStore): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: store });
}

export async function saveCredentialContinuation(input: CredentialContinuationInput): Promise<void> {
  if (input.kind === 'import-existing-account' || input.kind === 'website-password-update') {
    throw new Error('Per-site import and secret update are local Cj operations and cannot create website continuations.');
  }
  const createdAt = input.createdAt ?? Date.now();
  const expiresAt = input.expiresAt ?? createdAt + CREDENTIAL_CONTINUATION_TTL_MS;
  const vaultPassword = await getVaultPassword();
  const protectedMaterial = await encryptJson(vaultPassword, input.material, ENCRYPTION_PURPOSE);
  const stored: StoredCredentialContinuation = {
    version: 1,
    flowId: input.flowId,
    kind: input.kind,
    expectedStage: input.expectedStage ?? defaultExpectedStage(input.kind),
    siteId: input.siteId,
    tabId: input.tabId,
    origin: input.origin,
    createdAt,
    expiresAt,
    protectedMaterial,
  };
  const store = await readStore();
  store[recordKey(input.tabId, input.siteId)] = stored;
  await writeStore(store);
}

export async function advanceCredentialContinuation(
  tabId: number,
  siteId: string,
  expectedStage: CredentialContinuationExpectedStage,
  flowId?: string,
): Promise<boolean> {
  const store = await readStore();
  const key = recordKey(tabId, siteId);
  const stored = store[key];
  if (!stored || stored.expiresAt <= Date.now()) return false;
  if (flowId && stored.flowId && stored.flowId !== flowId) return false;
  stored.expectedStage = expectedStage;
  await writeStore(store);
  return true;
}

export async function loadCredentialContinuation(
  tabId: number,
  siteId: string,
): Promise<CredentialContinuation | undefined> {
  const store = await readStore();
  const key = recordKey(tabId, siteId);
  const stored = store[key];
  if (!stored) return undefined;
  if (stored.kind === 'import-existing-account' || stored.kind === 'website-password-update') {
    // Discard records created by older builds so they can never resume a
    // website password-change form after the local-only Cj migration.
    delete store[key];
    await writeStore(store);
    return undefined;
  }
  if (stored.version !== 1 || stored.expiresAt <= Date.now()) {
    delete store[key];
    await writeStore(store);
    return undefined;
  }
  const vaultPassword = await getVaultPassword();
  try {
    const material = await decryptJson<CredentialContinuationMaterial>(
      vaultPassword,
      stored.protectedMaterial,
      ENCRYPTION_PURPOSE,
    );
    return {
      ...stored,
      expectedStage: stored.expectedStage ?? defaultExpectedStage(stored.kind),
      material,
    };
  } catch {
    delete store[key];
    await writeStore(store);
    return undefined;
  }
}

export async function clearCredentialContinuation(
  tabId: number,
  siteId: string,
  flowId?: string,
): Promise<void> {
  const store = await readStore();
  const key = recordKey(tabId, siteId);
  const stored = store[key];
  if (!stored || !flowId || stored.flowId === flowId) {
    delete store[key];
    await writeStore(store);
  }
}
