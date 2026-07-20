import type { SitePageKind } from './pageClassifier';

const STORAGE_KEY = 'upspa_active_flow_session_v1';
export const FLOW_SESSION_TTL_MS = 30 * 60 * 1000;

export type FlowKind =
  | 'extension-setup'
  | 'website-signup'
  | 'website-signin'
  | 'import-existing-account'
  | 'website-password-update'
  | 'master-password-update'
  | 'dashboard';

export type FlowSession = {
  version: 1;
  flowId: string;
  kind: FlowKind;
  siteId?: string;
  accountId?: string;
  stage: string;
  pageKind?: SitePageKind;
  tabId?: number;
  pendingOperationId?: string;
  startedAt: number;
  expiresAt: number;
};

export type FlowSessionInput = Omit<FlowSession, 'version' | 'flowId' | 'startedAt' | 'expiresAt'> & {
  flowId?: string;
  startedAt?: number;
  expiresAt?: number;
};

function getStorageArea(): chrome.storage.StorageArea {
  const storage = chrome.storage as typeof chrome.storage & { session?: chrome.storage.StorageArea };
  return storage.session ?? chrome.storage.local;
}

function newFlowId(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(2));
  return `flow-${Date.now().toString(36)}-${bytes[0].toString(36)}${bytes[1].toString(36)}`;
}

function isFresh(session: FlowSession): boolean {
  return session.version === 1 && session.expiresAt > Date.now();
}

export async function saveFlowSession(input: FlowSessionInput): Promise<FlowSession> {
  const startedAt = input.startedAt ?? Date.now();
  const session: FlowSession = {
    ...input,
    version: 1,
    flowId: input.flowId ?? newFlowId(),
    startedAt,
    expiresAt: input.expiresAt ?? startedAt + FLOW_SESSION_TTL_MS,
  };
  await getStorageArea().set({ [STORAGE_KEY]: session });
  return session;
}

export async function loadFlowSession(): Promise<FlowSession | undefined> {
  const area = getStorageArea();
  const stored = (await area.get(STORAGE_KEY))[STORAGE_KEY] as FlowSession | undefined;
  if (!stored) return undefined;
  if (isFresh(stored)) return stored;
  await area.remove(STORAGE_KEY);
  return undefined;
}

export async function restoreFlowSession(input: {
  siteId?: string;
  tabId?: number;
}): Promise<FlowSession | undefined> {
  const session = await loadFlowSession();
  if (!session) return undefined;
  if (input.siteId && session.siteId && input.siteId !== session.siteId) return undefined;
  if (input.tabId !== undefined && session.tabId !== undefined && input.tabId !== session.tabId) return undefined;
  return session;
}

export async function updateFlowSession(
  patch: Partial<Pick<FlowSession, 'accountId' | 'stage' | 'pageKind' | 'pendingOperationId' | 'tabId'>>,
): Promise<FlowSession | undefined> {
  const session = await loadFlowSession();
  if (!session) return undefined;
  return saveFlowSession({ ...session, ...patch, flowId: session.flowId, startedAt: session.startedAt, expiresAt: session.expiresAt });
}

export async function clearFlowSession(flowId?: string): Promise<void> {
  const session = await loadFlowSession();
  if (!session || !flowId || session.flowId === flowId) {
    await getStorageArea().remove(STORAGE_KEY);
  }
}
