import { getConfig } from './config';
import { hasLocalStorageProviderSetup } from './localSpClient';

const STORAGE_KEY = 'upspa_setup_state_v1';

export type SetupState = {
  version: 1;
  uid: string;
  setupComplete: boolean;
  completedAt?: number;
};

export async function getSetupState(): Promise<SetupState | undefined> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const state = result[STORAGE_KEY] as SetupState | undefined;
  return state?.version === 1 ? state : undefined;
}

export async function markSetupComplete(uid: string): Promise<void> {
  const state: SetupState = { version: 1, uid: uid.trim(), setupComplete: true, completedAt: Date.now() };
  await chrome.storage.local.set({
    [STORAGE_KEY]: state,
  });
}

export async function isSetupComplete(): Promise<boolean> {
  const config = await getConfig();
  const state = await getSetupState();
  if (state?.setupComplete && state.uid === config.uid) return true;

  // Preserve a pre-existing local prototype installation instead of re-running setup.
  if (config.storageMode === 'local-prototype' && config.uid && await hasLocalStorageProviderSetup(config.uid)) {
    await markSetupComplete(config.uid);
    return true;
  }

  // Legacy distributed installations predate the explicit setup flag. Preserve their
  // configured mode instead of sending an already configured user through local setup.
  if (config.storageMode === 'distributed' && config.uid && config.sps.length > 0 && config.threshold >= 1) {
    await markSetupComplete(config.uid);
    return true;
  }

  return false;
}
