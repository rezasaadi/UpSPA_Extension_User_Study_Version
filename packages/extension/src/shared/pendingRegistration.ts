import type { RegistrationSpOut } from 'upspa-js';
import type { DeterministicPasswordMetadata, PasswordPolicy } from './passwordPolicy';
import { decryptJson, encryptJson, type EncryptedJsonBlob } from './protectedStorage';

const STORAGE_KEY = 'upspa_pending_registration_sessions';
const ENCRYPTION_PURPOSE = 'upspa-pending-registration-v1';

export const PENDING_REGISTRATION_TTL_MS = 30 * 60 * 1000;

export type PendingRegistrationStatus =
  | 'started'
  | 'credentials_generated'
  | 'submitted_to_website'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'committed'
  | 'failed';

export type PendingRegistrationSession = {
  version: 1;
  flowId: string;
  origin: string;
  websiteURL: string;
  uid: string;
  suid?: string;
  username?: string;
  email?: string;
  passwordPolicy?: PasswordPolicy;
  passwordMetadata?: DeterministicPasswordMetadata;
  counter: number;
  createdAt: number;
  expiresAt: number;
  status: PendingRegistrationStatus;
  confirmationNonce?: string;
  loginServerRequestId?: string;
};

export type PendingRegistrationSecrets = {
  version: 1;
  passwordForLs: string;
  records: RegistrationSpOut[];
};

export type PendingRegistrationSessionWithSecrets = PendingRegistrationSession & {
  passwordForLs?: string;
  records?: RegistrationSpOut[];
  protectedMaterialLocked?: boolean;
};

type StoredPendingRegistration = {
  version: 1;
  session: PendingRegistrationSession;
  protectedMaterial?: EncryptedJsonBlob;
};

type PendingRegistrationStore = Record<string, StoredPendingRegistration>;

export type PersistedPendingRegistration = PendingRegistrationSessionWithSecrets & {
  accountId: string;
  encoderCounter: number;
};

function nowMs(): number {
  return Date.now();
}

function defaultExpiresAt(createdAt = nowMs()): number {
  return createdAt + PENDING_REGISTRATION_TTL_MS;
}

function isExpired(session: PendingRegistrationSession): boolean {
  return session.expiresAt <= nowMs();
}

function isStoredRecord(value: unknown): value is StoredPendingRegistration {
  const record = value as StoredPendingRegistration | undefined;
  return record?.version === 1 && record.session?.version === 1 && Boolean(record.session.flowId);
}

async function readStore(): Promise<PendingRegistrationStore> {
  const out = await chrome.storage.local.get(STORAGE_KEY);
  const raw = out[STORAGE_KEY] as PendingRegistrationStore | undefined;
  const store: PendingRegistrationStore = {};

  for (const [flowId, value] of Object.entries(raw ?? {})) {
    if (isStoredRecord(value)) store[flowId] = value;
  }

  return store;
}

async function writeStore(store: PendingRegistrationStore): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: store });
}

function findStoredSession(
  store: PendingRegistrationStore,
  originOrFlowId?: string,
): StoredPendingRegistration | undefined {
  const records = Object.values(store).sort((a, b) => b.session.createdAt - a.session.createdAt);
  if (!originOrFlowId) return records[0];

  return records.find((record) => {
    const session = record.session;
    return (
      session.flowId === originOrFlowId ||
      session.origin === originOrFlowId ||
      session.websiteURL === originOrFlowId
    );
  });
}

async function materialFromStored(
  stored: StoredPendingRegistration,
  masterPassword?: string,
): Promise<PendingRegistrationSessionWithSecrets> {
  const session = stored.session;
  if (!stored.protectedMaterial) return { ...session };
  if (!masterPassword) return { ...session, protectedMaterialLocked: true };

  const secrets = await decryptJson<PendingRegistrationSecrets>(
    masterPassword,
    stored.protectedMaterial,
    `${ENCRYPTION_PURPOSE}:${session.flowId}`,
  );

  return {
    ...session,
    passwordForLs: secrets.passwordForLs,
    records: secrets.records,
    protectedMaterialLocked: false,
  };
}

export function createPendingRegistrationSession(
  input: Omit<PendingRegistrationSession, 'version' | 'createdAt' | 'expiresAt' | 'status'> &
    Partial<Pick<PendingRegistrationSession, 'createdAt' | 'expiresAt' | 'status'>>,
): PendingRegistrationSession {
  const createdAt = input.createdAt ?? nowMs();
  return {
    ...input,
    version: 1,
    createdAt,
    expiresAt: input.expiresAt ?? defaultExpiresAt(createdAt),
    status: input.status ?? 'started',
  };
}

export async function cleanupExpiredPendingRegistrationSessions(): Promise<void> {
  const store = await readStore();
  let changed = false;

  for (const [flowId, record] of Object.entries(store)) {
    if (isExpired(record.session)) {
      delete store[flowId];
      changed = true;
    }
  }

  if (changed) await writeStore(store);
}

export async function savePendingRegistrationSession(
  session: PendingRegistrationSession,
  secrets?: PendingRegistrationSecrets,
  masterPassword?: string,
): Promise<void> {
  const store = await readStore();
  let protectedMaterial: EncryptedJsonBlob | undefined;

  if (secrets) {
    if (!masterPassword) {
      throw new Error('Master password is required to persist protected registration material.');
    }
    protectedMaterial = await encryptJson(
      masterPassword,
      { ...secrets, version: 1 },
      `${ENCRYPTION_PURPOSE}:${session.flowId}`,
    );
  } else {
    protectedMaterial = store[session.flowId]?.protectedMaterial;
  }

  store[session.flowId] = {
    version: 1,
    session,
    protectedMaterial,
  };

  await writeStore(store);
  await cleanupExpiredPendingRegistrationSessions();
}

export async function loadPendingRegistrationSession(
  originOrFlowId?: string,
  masterPassword?: string,
): Promise<PendingRegistrationSessionWithSecrets | undefined> {
  await cleanupExpiredPendingRegistrationSessions();
  const store = await readStore();
  const stored = findStoredSession(store, originOrFlowId);
  if (!stored) return undefined;
  if (isExpired(stored.session)) {
    await clearPendingRegistrationSession(stored.session.flowId);
    return undefined;
  }

  return materialFromStored(stored, masterPassword);
}

export async function updatePendingRegistrationSession(
  flowId: string,
  patch: Partial<PendingRegistrationSession>,
  secrets?: PendingRegistrationSecrets,
  masterPassword?: string,
): Promise<PendingRegistrationSessionWithSecrets | undefined> {
  const store = await readStore();
  const existing = store[flowId];
  if (!existing) return undefined;

  const session: PendingRegistrationSession = {
    ...existing.session,
    ...patch,
    version: 1,
    flowId: existing.session.flowId,
  };

  let protectedMaterial = existing.protectedMaterial;
  if (secrets) {
    if (!masterPassword) {
      throw new Error('Master password is required to update protected registration material.');
    }
    protectedMaterial = await encryptJson(
      masterPassword,
      { ...secrets, version: 1 },
      `${ENCRYPTION_PURPOSE}:${flowId}`,
    );
  }

  store[flowId] = {
    version: 1,
    session,
    protectedMaterial,
  };
  await writeStore(store);

  return materialFromStored(store[flowId], masterPassword);
}

export async function clearPendingRegistrationSession(flowId: string): Promise<void> {
  const store = await readStore();
  delete store[flowId];
  await writeStore(store);
}

export async function clearAllPendingRegistrationSessions(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

function firstAccountId(session: PendingRegistrationSessionWithSecrets): string {
  return session.username || session.email || '';
}

export async function savePendingRegistration(
  data: Omit<PersistedPendingRegistration, 'createdAt' | 'expiresAt' | 'version' | 'status' | 'flowId' | 'websiteURL' | 'counter'> & {
    flowId?: string;
    websiteURL?: string;
    counter?: number;
    createdAt?: number;
    expiresAt?: number;
    status?: PendingRegistrationStatus;
    passwordForLs?: string;
  },
  masterPassword?: string,
): Promise<void> {
  const createdAt = data.createdAt ?? nowMs();
  const session = createPendingRegistrationSession({
    flowId: data.flowId ?? crypto.randomUUID(),
    origin: data.origin,
    websiteURL: data.websiteURL ?? data.origin,
    uid: data.uid,
    suid: data.suid,
    username: data.username ?? data.accountId,
    email: data.email,
    passwordPolicy: data.passwordPolicy,
    passwordMetadata: data.passwordMetadata,
    counter: data.counter ?? data.encoderCounter,
    createdAt,
    expiresAt: data.expiresAt ?? defaultExpiresAt(createdAt),
    status: data.status ?? 'awaiting_confirmation',
    confirmationNonce: data.confirmationNonce,
    loginServerRequestId: data.loginServerRequestId,
  });

  const secrets =
    data.records && data.passwordForLs
      ? {
          version: 1 as const,
          passwordForLs: data.passwordForLs,
          records: data.records,
        }
      : undefined;

  await savePendingRegistrationSession(session, secrets, masterPassword);
}

export async function loadPendingRegistration(
  originOrFlowId?: string,
  masterPassword?: string,
): Promise<PersistedPendingRegistration | undefined> {
  const session = await loadPendingRegistrationSession(originOrFlowId, masterPassword);
  if (!session) return undefined;

  return {
    ...session,
    accountId: firstAccountId(session),
    encoderCounter: session.counter,
  };
}

export async function clearPendingRegistration(flowId?: string): Promise<void> {
  if (flowId) {
    await clearPendingRegistrationSession(flowId);
    return;
  }

  const pending = await loadPendingRegistrationSession();
  if (pending) await clearPendingRegistrationSession(pending.flowId);
}
