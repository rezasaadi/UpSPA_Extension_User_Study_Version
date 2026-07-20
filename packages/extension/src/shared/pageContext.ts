import type { ExtensionEvent, FieldDetectionSummary, PrototypeFormType } from './events/extensionEvents';
import type { SitePageKind } from './pageClassifier';

const STORAGE_KEY = 'upspa_page_contexts_v1';
export const PAGE_CONTEXT_TTL_MS = 2 * 60 * 1000;

export type DetectedPageContext = {
  version: 1;
  tabId: number;
  frameId: number;
  siteId: string;
  url: string;
  origin: string;
  pageKind?: SitePageKind;
  formType: PrototypeFormType;
  fields: FieldDetectionSummary;
  updatedAt: number;
  expiresAt: number;
};

type PageContextStore = Record<string, DetectedPageContext>;

function getStorageArea(): chrome.storage.StorageArea {
  const storage = chrome.storage as typeof chrome.storage & { session?: chrome.storage.StorageArea };
  return storage.session ?? chrome.storage.local;
}

function contextKey(tabId: number, frameId: number): string {
  return `${tabId}:${frameId}`;
}

async function readStore(): Promise<PageContextStore> {
  const stored = await getStorageArea().get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as PageContextStore | undefined) ?? {};
}

async function writeStore(store: PageContextStore): Promise<void> {
  await getStorageArea().set({ [STORAGE_KEY]: store });
}

export function credentialFieldEvidenceScore(fields: FieldDetectionSummary): number {
  let score = 0;
  if (fields.username) score += 30;
  if (fields.password) score += 40;
  score += Math.min(Math.max(fields.passwordCount, 0), 3) * 5;
  if (fields.currentPassword) score += 15;
  if (fields.newPassword) score += 15;
  if (score > 0 && fields.submit) score += 2;
  return score;
}

export async function saveDetectedPageContext(
  event: Extract<ExtensionEvent, { type: 'FORM_DETECTED' }>,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || !event.siteId) return;
  const frameId = sender.frameId ?? 0;
  const updatedAt = Date.now();
  const store = await readStore();
  store[contextKey(tabId, frameId)] = {
    version: 1,
    tabId,
    frameId,
    siteId: event.siteId,
    url: event.url,
    origin: event.origin,
    formType: event.formType,
    fields: event.fields,
    updatedAt,
    expiresAt: updatedAt + PAGE_CONTEXT_TTL_MS,
  };
  await writeStore(store);
}

export async function getDetectedPageContext(
  tabId: number,
  siteId: string,
  activeFrameIds?: number[],
): Promise<DetectedPageContext | undefined> {
  const store = await readStore();
  const now = Date.now();
  let changed = false;
  const candidates: DetectedPageContext[] = [];
  for (const [key, context] of Object.entries(store)) {
    const frameIsActive = !activeFrameIds || activeFrameIds.includes(context.frameId);
    if (context.expiresAt <= now || !frameIsActive) {
      delete store[key];
      changed = true;
      continue;
    }
    if (context.tabId === tabId && context.siteId === siteId) candidates.push(context);
  }
  if (changed) await writeStore(store);
  candidates.sort((a, b) => {
    const aEvidence = credentialFieldEvidenceScore(a.fields);
    const bEvidence = credentialFieldEvidenceScore(b.fields);
    const aKnown = a.formType === 'unknown' ? 0 : 1;
    const bKnown = b.formType === 'unknown' ? 0 : 1;
    return Number(bEvidence > 0) - Number(aEvidence > 0)
      || bEvidence - aEvidence
      || bKnown - aKnown
      || b.updatedAt - a.updatedAt;
  });
  return candidates[0];
}
