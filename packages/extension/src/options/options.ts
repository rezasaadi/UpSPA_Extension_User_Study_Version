import { getConfig, LOCAL_PROTOTYPE_SP } from '../shared/config';
import { markSessionUsed, rememberMasterPasswordForSession } from '../shared/session';
import { markSetupComplete, isSetupComplete } from '../shared/setupState';
import { setupAndProvision } from '../shared/upspaActions';
import { MIN_MASTER_PASSWORD_LENGTH, meetsMasterPasswordLength } from '../shared/masterPasswordPolicy';

const SETUP_RETURN_URL_KEY = 'upspa_setup_return_url';

type SetupStage = 'master' | 'checklist' | 'review' | 'success';
type SetupControllerState = { uid: string; masterPassword: string; stage: SetupStage };

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing setup element: ${id}`);
  return element as T;
}

const uidEl = byId<HTMLInputElement>('uid');
const passwordEl = byId<HTMLInputElement>('password');
const passwordConfirmEl = byId<HTMLInputElement>('passwordConfirm');
const checkPersonalEl = byId<HTMLInputElement>('checkPersonal');
const checkUniqueEl = byId<HTMLInputElement>('checkUnique');
const checkPrivateEl = byId<HTMLInputElement>('checkPrivate');
const statusEl = byId<HTMLPreElement>('status');
const returnToSiteButton = byId<HTMLButtonElement>('returnToSite');

let controller: SetupControllerState = { uid: '', masterPassword: '', stage: 'master' };
let returnUrl = '';

function setStatus(message: string, kind: 'normal' | 'error' = 'normal'): void {
  statusEl.textContent = message;
  statusEl.className = kind === 'error' ? 'error' : '';
}

function showStage(stage: SetupStage): void {
  controller.stage = stage;
  document.querySelector<HTMLElement>('.setup-card')?.setAttribute('data-stage', stage);
  document.querySelectorAll<HTMLElement>('.setup-screen').forEach((screen) => screen.classList.add('hidden'));
  byId<HTMLElement>(`setup-${stage}`).classList.remove('hidden');
}

function validReturnUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

async function loadReturnUrl(): Promise<void> {
  const queryReturnUrl = validReturnUrl(new URLSearchParams(location.search).get('returnUrl'));
  const stored = await chrome.storage.local.get(SETUP_RETURN_URL_KEY);
  returnUrl = queryReturnUrl || validReturnUrl(stored[SETUP_RETURN_URL_KEY]);
  returnToSiteButton.classList.toggle('hidden', !returnUrl);
}

function readMasterStage(): Pick<SetupControllerState, 'uid' | 'masterPassword'> {
  const uid = uidEl.value.trim();
  const masterPassword = passwordEl.value;
  if (!uid) throw new Error('Enter an UpSPA account ID.');
  if (!meetsMasterPasswordLength(masterPassword)) {
    throw new Error(`Choose a master password with at least ${MIN_MASTER_PASSWORD_LENGTH} characters.`);
  }
  if (masterPassword !== passwordConfirmEl.value) throw new Error('The master password fields do not match.');
  return { uid, masterPassword };
}

function goBackToSite(): void {
  if (!returnUrl) return;
  void chrome.storage.local.remove(SETUP_RETURN_URL_KEY);
  window.location.assign(returnUrl);
}

async function completeSetup(): Promise<void> {
  if (!controller.uid || !controller.masterPassword) throw new Error('Return to the first setup stage and enter the master password again.');
  setStatus('Creating your UpSPA account and provisioning the local Storage Provider...');
  await setupAndProvision({
    uid: controller.uid,
    password: controller.masterPassword,
    threshold: 1,
    sps: [LOCAL_PROTOTYPE_SP],
    storageMode: 'local-prototype',
  });
  await markSetupComplete(controller.uid);
  await rememberMasterPasswordForSession(controller.masterPassword);
  await markSessionUsed();
  controller = { uid: controller.uid, masterPassword: '', stage: 'success' };
  passwordEl.value = '';
  passwordConfirmEl.value = '';
  showStage('success');
  setStatus('Setup complete. The local Storage Provider was provisioned automatically.');
}

byId<HTMLButtonElement>('setupContinue').addEventListener('click', () => {
  try {
    controller = { ...controller, ...readMasterStage(), stage: 'checklist' };
    showStage('checklist');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
});

byId<HTMLButtonElement>('setupChecklistContinue').addEventListener('click', () => {
  if (!checkPersonalEl.checked || !checkUniqueEl.checked || !checkPrivateEl.checked) {
    setStatus('Complete every checklist item before continuing.', 'error');
    return;
  }
  showStage('review');
});
byId<HTMLButtonElement>('setupChecklistBack').addEventListener('click', () => showStage('master'));
byId<HTMLButtonElement>('setupReviewBack').addEventListener('click', () => showStage('checklist'));
byId<HTMLButtonElement>('setupConfirm').addEventListener('click', () => {
  void completeSetup().catch((error) => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});
returnToSiteButton.addEventListener('click', goBackToSite);

async function initialize(): Promise<void> {
  await loadReturnUrl();
  const config = await getConfig();
  uidEl.value = config.uid || 'upspa-demo-user';
  if (await isSetupComplete()) {
    controller = { uid: config.uid, masterPassword: '', stage: 'success' };
    showStage('success');
    setStatus('UpSPA setup is already complete. Master-password changes are available from the extension dashboard.');
  } else {
    showStage('master');
    setStatus('Ready to create a local prototype UpSPA account.');
  }
}

initialize().catch((error) => setStatus(error instanceof Error ? error.message : String(error), 'error'));
