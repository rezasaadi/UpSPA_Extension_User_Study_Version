export const SESSION_TTL_MS = 30 * 60 * 1000;

type SessionState = {
  lastUsedAt?: number;
};

const STORAGE_KEY = 'upspa_session';
const MASTER_PASSWORD_SESSION_KEY = 'upspa_master_password_session_v1';

type MasterPasswordSession = {
  version: 1;
  masterPassword: string;
  expiresAt: number;
};

function getEphemeralStorage(): chrome.storage.StorageArea | undefined {
  return (chrome.storage as typeof chrome.storage & { session?: chrome.storage.StorageArea }).session;
}

async function getSessionState(): Promise<SessionState> {
  const out = await chrome.storage.local.get(STORAGE_KEY);
  return out[STORAGE_KEY] ?? {};
}

export async function isSessionFresh(): Promise<boolean> {
  const state = await getSessionState();
  if (!state.lastUsedAt) return false;
  return Date.now() - state.lastUsedAt <= SESSION_TTL_MS;
}

export async function markSessionUsed(): Promise<void> {
  const state: SessionState = {
    lastUsedAt: Date.now(),
  };
  await chrome.storage.local.set({
    [STORAGE_KEY]: state,
  });
}

export async function rememberMasterPasswordForSession(
  masterPassword: string,
  now = Date.now(),
): Promise<void> {
  if (!masterPassword) throw new Error('Cannot unlock the extension session with an empty master password.');
  const area = getEphemeralStorage();
  if (!area) throw new Error('Temporary extension session storage is unavailable.');
  const session: MasterPasswordSession = {
    version: 1,
    masterPassword,
    expiresAt: now + SESSION_TTL_MS,
  };
  await area.set({ [MASTER_PASSWORD_SESSION_KEY]: session });
}

export async function loadMasterPasswordFromSession(now = Date.now()): Promise<string | undefined> {
  const area = getEphemeralStorage();
  if (!area) return undefined;
  const stored = (await area.get(MASTER_PASSWORD_SESSION_KEY))[MASTER_PASSWORD_SESSION_KEY] as MasterPasswordSession | undefined;
  if (stored?.version !== 1 || !stored.masterPassword || stored.expiresAt <= now) {
    if (stored) await area.remove(MASTER_PASSWORD_SESSION_KEY);
    return undefined;
  }
  await rememberMasterPasswordForSession(stored.masterPassword, now);
  return stored.masterPassword;
}

export async function clearMasterPasswordFromSession(): Promise<void> {
  await getEphemeralStorage()?.remove(MASTER_PASSWORD_SESSION_KEY);
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
  await clearMasterPasswordFromSession();
}
