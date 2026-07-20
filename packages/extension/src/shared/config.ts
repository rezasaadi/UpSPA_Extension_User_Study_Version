export type SpConfig = {
  id: number;
  baseUrl: string;
};
export type StorageMode = 'distributed' | 'local-prototype';
export type UpspaConfig = {
  enabled: boolean;
  uid: string;
  threshold: number;
  sps: SpConfig[];
  storageMode: StorageMode;
};
const STORAGE_KEY = 'upspa_config';
const DEFAULT_CONFIG: UpspaConfig = {
  enabled: true,
  uid: 'upspa-demo-user',
  threshold: 1,
  sps: [{ id: 1, baseUrl: 'local://sp-1' }],
  storageMode: 'local-prototype',
};
export const LOCAL_PROTOTYPE_SP: SpConfig = { id: 1, baseUrl: 'local://sp-1' };
export function localPrototypeConfig(uid: string): UpspaConfig {
  return {
    enabled: true,
    uid: uid.trim() || DEFAULT_CONFIG.uid,
    threshold: 1,
    sps: [LOCAL_PROTOTYPE_SP],
    storageMode: 'local-prototype',
  };
}
export async function getConfig(): Promise<UpspaConfig> {
  const out = await chrome.storage.local.get(STORAGE_KEY);
  const stored = out[STORAGE_KEY] as Partial<UpspaConfig> | undefined;
  return {
    ...DEFAULT_CONFIG,
    ...(stored ?? {}),
    storageMode: stored?.storageMode ?? 'local-prototype',
  };
}
export async function setConfig(cfg: UpspaConfig): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY]: cfg,
  });
}
