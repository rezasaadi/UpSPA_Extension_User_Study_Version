import { getConfig } from '../shared/config';
import {
  clearFlowSession,
  restoreFlowSession,
  saveFlowSession,
  updateFlowSession,
  type FlowKind,
  type FlowSession,
} from '../shared/flowSession';
import type { BgRequest, BgResponse, ContentFillRequest, ContentFillResponse } from '../shared/messages';
import type { CredentialContinuationMaterial } from '../shared/credentialContinuation';
import type { DetectedPageContext } from '../shared/pageContext';
import {
  orderCredentialFrameCandidates,
  tryCredentialFramesSequentially,
  type CandidateFrame,
} from '../shared/frameTargeting';
import {
  clearPendingRegistrationSession,
  createPendingRegistrationSession,
  loadPendingRegistrationSession,
  savePendingRegistrationSession,
  type PendingRegistrationSessionWithSecrets,
} from '../shared/pendingRegistration';
import {
  clearPendingSecretUpdateSession,
} from '../shared/pendingSecretUpdate';
import {
  encodePasswordDeterministically,
  encodeSecretAsPassword,
  normalizePasswordPolicy,
  passwordPolicyHash,
  type DeterministicPasswordMetadata,
  type PasswordPolicy,
} from '../shared/passwordPolicy';
import { applyDetectedFormFallback, classifyPage, type SitePageKind } from '../shared/pageClassifier';
import {
  getAccountForOrigin,
  getAccountsForOrigin,
  getAllSiteAccounts,
  upsertAccountForOrigin,
  type SiteAccount,
} from '../shared/siteAccounts';
import { makeLsj } from '../shared/siteIdentity';
import {
  clearSession,
  loadMasterPasswordFromSession,
  markSessionUsed,
  rememberMasterPasswordForSession,
} from '../shared/session';
import { isSetupComplete } from '../shared/setupState';
import { MIN_MASTER_PASSWORD_LENGTH, meetsMasterPasswordLength } from '../shared/masterPasswordPolicy';
import { type SupportedPrototypeSite } from '../shared/supportedSites';
import {
  authenticateForSite,
  commitMigrationForSite,
  commitRegistrationForSite,
  commitSecretUpdateForSite,
  passwordUpdateDirect,
  prepareMigrationForSite,
  prepareRegistrationForSite,
  prepareSecretUpdateForSite,
} from '../shared/upspaActions';
import { publishChromeExtensionEvent } from '../shared/events/chromeEventBridge';
import {
  makeExtensionEvent,
  type ExtensionEventInput,
  type PrototypeScreen,
} from '../shared/events/extensionEvents';

type PickerMode = 'sign-in' | 'website-password-update' | 'dashboard';
type PendingRegistration = PendingRegistrationSessionWithSecrets;
type ContentFillSuccess = Extract<ContentFillResponse, { ok: true }>;
type MasterUpdateState = { currentPassword: string; newPassword?: string };

const SETUP_RETURN_URL_KEY = 'upspa_setup_return_url';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: ${id}`);
  return element as T;
}

const appEl = byId<HTMLElement>('app');
const statusEl = byId<HTMLDivElement>('status');
const unsupportedMessageEl = byId<HTMLParagraphElement>('unsupportedMessage');
const dashboardTitleEl = byId<HTMLHeadingElement>('dashboardTitle');
const activeSiteSummaryEl = byId<HTMLParagraphElement>('activeSiteSummary');
const dashboardAccountsEl = byId<HTMLDivElement>('dashboardAccounts');
const pickerTitleEl = byId<HTMLHeadingElement>('pickerTitle');
const pickerDescriptionEl = byId<HTMLParagraphElement>('pickerDescription');
const pickerAccountsEl = byId<HTMLDivElement>('pickerAccounts');
const pickerContinueButton = byId<HTMLButtonElement>('pickerContinue');
const addAccountChoiceDescriptionEl = byId<HTMLParagraphElement>('addAccountChoiceDescription');
const createNewAccountButton = byId<HTMLButtonElement>('createNewAccount');
const detailsTitleEl = byId<HTMLHeadingElement>('detailsTitle');
const detailsDescriptionEl = byId<HTMLParagraphElement>('detailsDescription');
const detailsSiteEl = byId<HTMLDivElement>('detailsSite');
const detailsMasterFieldEl = byId<HTMLLabelElement>('detailsMasterField');
const siteAccountIdEl = byId<HTMLInputElement>('siteAccountId');
const siteDetailsMasterPasswordEl = byId<HTMLInputElement>('siteDetailsMasterPassword');
const detailsContinueButton = byId<HTMLButtonElement>('detailsContinue');
const masterAuthSiteEl = byId<HTMLSpanElement>('masterAuthSite');
const masterAuthAccountEl = byId<HTMLInputElement>('masterAuthAccount');
const masterAuthPasswordFieldEl = byId<HTMLLabelElement>('masterAuthPasswordField');
const masterAuthPasswordEl = byId<HTMLInputElement>('masterAuthPassword');
const settingsTitleEl = byId<HTMLHeadingElement>('settingsTitle');
const settingsDescriptionEl = byId<HTMLParagraphElement>('settingsDescription');
const policyCardEl = byId<HTMLDivElement>('policyCard');
const settingsMasterFieldEl = byId<HTMLLabelElement>('settingsMasterField');
const settingsMasterPasswordEl = byId<HTMLInputElement>('settingsMasterPassword');
const existingPasswordFieldEl = byId<HTMLLabelElement>('existingPasswordField');
const existingWebsitePasswordEl = byId<HTMLInputElement>('existingWebsitePassword');
const candidateFieldEl = byId<HTMLLabelElement>('candidateField');
const candidatePasswordEl = byId<HTMLInputElement>('candidatePassword');
const settingsSubmitButton = byId<HTMLButtonElement>('settingsSubmit');
const generateCandidateButton = byId<HTMLButtonElement>('generateCandidate');
const policyMinLenEl = byId<HTMLInputElement>('policyMinLen');
const policyMaxLenEl = byId<HTMLInputElement>('policyMaxLen');
const policyUpperEl = byId<HTMLInputElement>('policyUpper');
const policyLowerEl = byId<HTMLInputElement>('policyLower');
const policyDigitEl = byId<HTMLInputElement>('policyDigit');
const policySymbolEl = byId<HTMLInputElement>('policySymbol');
const policyWhitespaceEl = byId<HTMLInputElement>('policyWhitespace');
const policySymbolsEl = byId<HTMLInputElement>('policySymbols');
const policyForbiddenEl = byId<HTMLInputElement>('policyForbidden');
const policyEvidenceEl = byId<HTMLParagraphElement>('policyEvidence');
const waitingTitleEl = byId<HTMLHeadingElement>('waitingTitle');
const waitingDescriptionEl = byId<HTMLParagraphElement>('waitingDescription');
const waitingDetailEl = byId<HTMLParagraphElement>('waitingDetail');
const confirmationMasterFieldEl = byId<HTMLLabelElement>('confirmationMasterField');
const confirmationMasterPasswordEl = byId<HTMLInputElement>('confirmationMasterPassword');
const confirmOperationButton = byId<HTMLButtonElement>('confirmOperation');
const resumePendingFillButton = byId<HTMLButtonElement>('resumePendingFill');
const successTitleEl = byId<HTMLHeadingElement>('successTitle');
const successDescriptionEl = byId<HTMLParagraphElement>('successDescription');
const masterCurrentPasswordFieldEl = byId<HTMLLabelElement>('masterCurrentPasswordField');
const masterCurrentPasswordEl = byId<HTMLInputElement>('masterCurrentPassword');
const masterNewPasswordEl = byId<HTMLInputElement>('masterNewPassword');
const masterNewPasswordConfirmEl = byId<HTMLInputElement>('masterNewPasswordConfirm');
const masterChecklistPersonalEl = byId<HTMLInputElement>('masterChecklistPersonal');
const masterChecklistUniqueEl = byId<HTMLInputElement>('masterChecklistUnique');
const masterChecklistSafeEl = byId<HTMLInputElement>('masterChecklistSafe');

let activeTabId: number | undefined;
let activeOrigin = '';
let activeCredentialOrigin = '';
let activeWebsiteUrl = '';
let activeSite: SupportedPrototypeSite | undefined;
let activePageKind: SitePageKind = 'unsupported';
let activeFormFrameId: number | undefined;
let siteAccounts: SiteAccount[] = [];
let currentFlow: FlowSession | undefined;
let pickerMode: PickerMode = 'dashboard';
let currentEncoderCounter = 0;
let transientMasterPassword = '';
let masterUpdateState: MasterUpdateState | undefined;
let isBusy = false;
let navigationRefreshTimer: number | undefined;

const WORKFLOW_SCREENS = new Set<PrototypeScreen>([
  'dashboard',
  'account-picker',
  'add-account-choice',
  'site-account-details',
  'site-password-settings',
  'waiting-confirmation',
  'operation-success',
]);

function setStatus(message: string, kind: 'normal' | 'error' = 'normal'): void {
  statusEl.textContent = message;
  statusEl.className = kind === 'error' ? 'status error' : 'status';
}

function setBusy(nextBusy: boolean): void {
  isBusy = nextBusy;
  if (!nextBusy) {
    refreshControls();
    return;
  }
  document.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.disabled = true;
  });
}

function refreshControls(): void {
  if (isBusy) return;
  document.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.disabled = false;
  });
  if (appEl.dataset.screen === 'dashboard') {
    const hasAccounts = siteAccounts.length > 0;
    byId<HTMLButtonElement>('dashboardSignIn').disabled = !hasAccounts;
    byId<HTMLButtonElement>('dashboardUpdateWebsitePassword').disabled = !hasAccounts;
  }
  if (appEl.dataset.screen === 'account-picker') {
    pickerContinueButton.disabled = siteAccounts.length === 0;
  }
}

async function emit(event: ExtensionEventInput): Promise<void> {
  await publishChromeExtensionEvent(makeExtensionEvent(event));
}

function showScreen(screen: PrototypeScreen, reason?: string): void {
  if (screen === 'add-account-choice') {
    const registrationSupported = activeSite?.registrationSupported !== false;
    createNewAccountButton.classList.toggle('hidden', !registrationSupported);
    addAccountChoiceDescriptionEl.textContent = registrationSupported
      ? 'Choose whether you are creating a new website account or enrolling one you already use.'
      : 'This provider does not support normal website registration. Import an existing password locally instead.';
  }
  appEl.dataset.screen = screen;
  appEl.dataset.layout = WORKFLOW_SCREENS.has(screen) ? 'workflow' : 'auth';
  document.querySelectorAll<HTMLElement>('.screen').forEach((element) => element.classList.add('hidden'));
  document.getElementById(`screen-${screen}`)?.classList.remove('hidden');
  refreshControls();
  void emit({ type: 'SCREEN_CHANGED', source: 'popup', screen, reason });
}

async function run(task: () => Promise<void>): Promise<void> {
  if (isBusy) return;
  setBusy(true);
  try {
    await task();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function unlockWithMasterPassword(masterPassword: string): Promise<void> {
  transientMasterPassword = masterPassword;
  await rememberMasterPasswordForSession(masterPassword);
}

function requireActiveSite(): SupportedPrototypeSite {
  if (!activeSite || !activeOrigin || !activeCredentialOrigin) {
    throw new Error('This page is not a supported UpSPA prototype site.');
  }
  return activeSite;
}

function requirePasswordCapableSite(): SupportedPrototypeSite {
  const site = requireActiveSite();
  if (site.credentialMode === 'passwordless') {
    throw new Error(`${site.label} does not expose a website password form, so UpSPA password generation and autofill do not apply.`);
  }
  return site;
}

function accountInitial(accountId: string): string {
  return accountId.trim().slice(0, 1).toUpperCase() || 'U';
}

function selectedAccountId(): string {
  return currentFlow?.accountId || siteAccountIdEl.value.trim();
}

function selectedAccount(): SiteAccount | undefined {
  const accountId = selectedAccountId();
  return siteAccounts.find((account) => account.accountId === accountId);
}

function renderPolicy(policy: PasswordPolicy, counter: number): void {
  const normalized = normalizePasswordPolicy(policy);
  currentEncoderCounter = counter;
  policyMinLenEl.value = String(normalized.minLength);
  policyMaxLenEl.value = String(normalized.maxLength);
  policyUpperEl.checked = normalized.requireUppercase;
  policyLowerEl.checked = normalized.requireLowercase;
  policyDigitEl.checked = normalized.requireDigit;
  policySymbolEl.checked = normalized.requireSpecial;
  policyWhitespaceEl.checked = /[\s]/.test(normalized.disallowedChars);
  policySymbolsEl.value = normalized.allowedSpecials;
  policyForbiddenEl.value = (normalized.forbiddenSubstrings ?? []).join(', ');
  policyEvidenceEl.textContent = `Counter ${counter}. ${activeSite?.policyNote ?? ''}`;
}

function readPolicy(): PasswordPolicy {
  return normalizePasswordPolicy({
    minLength: Number(policyMinLenEl.value),
    maxLength: Number(policyMaxLenEl.value),
    requireUppercase: policyUpperEl.checked,
    requireLowercase: policyLowerEl.checked,
    requireDigit: policyDigitEl.checked,
    requireSpecial: policySymbolEl.checked,
    disallowedChars: policyWhitespaceEl.checked ? ' \t\r\n' : '',
    allowedSpecials: policySymbolsEl.value,
    forbiddenSubstrings: policyForbiddenEl.value.split(',').map((value) => value.trim()).filter(Boolean),
    source: ['domain-quirk'],
  });
}

function getActiveOrigin(url: string | undefined): string {
  if (!url) throw new Error('No active website URL found.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('UpSPA can only run on normal website pages.');
  }
  return parsed.origin;
}

function getCredentialOrigin(site: SupportedPrototypeSite, pageOrigin: string): string {
  const configured = (site as SupportedPrototypeSite & { credentialOrigin?: string }).credentialOrigin?.trim();
  if (!configured) return pageOrigin;
  const parsed = new URL(configured.includes('://') ? configured : `https://${configured}`);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Invalid credential origin configured for ${site.label}.`);
  }
  return parsed.origin;
}

async function loadAccounts(preferredAccountId?: string): Promise<void> {
  siteAccounts = await getAccountsForOrigin(activeCredentialOrigin);
  if (preferredAccountId && siteAccounts.some((account) => account.accountId === preferredAccountId)) {
    siteAccountIdEl.value = preferredAccountId;
  } else if (!siteAccountIdEl.value && siteAccounts[0]) {
    siteAccountIdEl.value = siteAccounts[0].accountId;
  }
}

async function saveFlow(kind: FlowKind, stage: string, accountId?: string, pendingOperationId?: string): Promise<FlowSession> {
  const site = requireActiveSite();
  currentFlow = await saveFlowSession({
    kind,
    siteId: site.id,
    accountId,
    stage,
    pageKind: activePageKind,
    tabId: activeTabId,
    pendingOperationId,
  });
  return currentFlow;
}

async function advanceFlow(stage: string, patch: Partial<Pick<FlowSession, 'accountId' | 'pendingOperationId'>> = {}): Promise<FlowSession> {
  if (!currentFlow) throw new Error('No active flow exists.');
  const next = await updateFlowSession({ ...patch, stage, pageKind: activePageKind, tabId: activeTabId });
  if (!next) throw new Error('The active flow expired. Start again.');
  currentFlow = next;
  return next;
}

async function sendFillCommand(message: ContentFillRequest): Promise<ContentFillResponse> {
  if (activeTabId === undefined) throw new Error('No active tab found.');
  const site = requireActiveSite();
  try {
    await loadFreshPageContext();
  } catch {
    // Frame enumeration below remains a safe fallback if the worker is waking.
  }
  const scopedMessage: ContentFillRequest = 'payload' in message
    ? { ...message, payload: { ...message.payload, siteId: site.id } } as ContentFillRequest
    : message;
  const frameOrderingOptions = {
    preferredFrameId: activeFormFrameId,
    siteId: site.id,
    siteIdForUrl: (url: string) => classifyPage(url).site?.id,
  };
  let frameIds = orderCredentialFrameCandidates([], frameOrderingOptions);
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: activeTabId });
    if (frames?.length) {
      frameIds = orderCredentialFrameCandidates(frames as CandidateFrame[], frameOrderingOptions);
    }
  } catch {
    // Fall back to the top frame on browsers without webNavigation frame enumeration.
  }

  const attempt = await tryCredentialFramesSequentially(frameIds, (frameId) => (
    new Promise<ContentFillResponse | undefined>((resolve) => {
      chrome.tabs.sendMessage(activeTabId!, scopedMessage, { frameId }, (candidate: ContentFillResponse | undefined) => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(candidate);
      });
    })
  ));
  if (attempt.response && attempt.frameId !== undefined) {
    activeFormFrameId = attempt.frameId;
    return attempt.response;
  }
  return attempt.firstFailure ?? { ok: false, error: 'The UpSPA content script did not find a credential frame on this page.' };
}

async function sendBackgroundRequest(message: BgRequest): Promise<BgResponse> {
  const response = await chrome.runtime.sendMessage(message) as BgResponse | undefined;
  if (!response) throw new Error('The UpSPA background worker did not respond.');
  if (!response.ok) throw new Error(response.error);
  return response;
}

async function saveCredentialContinuation(
  material: CredentialContinuationMaterial,
  flowId?: string,
): Promise<void> {
  const site = requireActiveSite();
  if (activeTabId === undefined) throw new Error('No active tab is available for multi-step continuation.');
  await sendBackgroundRequest({
    type: 'UPSPA_SAVE_CREDENTIAL_CONTINUATION',
    continuation: {
      flowId,
      kind: material.kind,
      siteId: site.id,
      tabId: activeTabId,
      origin: activeOrigin,
      material,
    },
  });
}

async function clearCredentialContinuation(flowId?: string): Promise<void> {
  if (!activeSite || activeTabId === undefined) return;
  await sendBackgroundRequest({
    type: 'UPSPA_CLEAR_CREDENTIAL_CONTINUATION',
    siteId: activeSite.id,
    tabId: activeTabId,
    flowId,
  });
}

async function loadFreshPageContext(): Promise<DetectedPageContext | undefined> {
  if (!activeSite || activeTabId === undefined) return undefined;
  let latest: DetectedPageContext | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await sendBackgroundRequest({
      type: 'UPSPA_GET_PAGE_CONTEXT',
      siteId: activeSite.id,
      tabId: activeTabId,
    });
    latest = 'pageContext' in response ? response.pageContext : undefined;
    if (latest) activeFormFrameId = latest.frameId;
    if (latest && latest.formType !== 'unknown') return latest;
    if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 140));
  }
  return latest;
}

async function fillOrThrow(message: ContentFillRequest): Promise<ContentFillSuccess> {
  const response = await sendFillCommand(message);
  if (!response.ok) throw new Error(response.error);
  return response;
}

function describeFilled(response: ContentFillSuccess): string {
  const parts: string[] = [];
  if (response.filled.username) parts.push('account identifier');
  if (response.filled.passwords) parts.push(`${response.filled.passwords} password field${response.filled.passwords === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' and ') : 'visible fields';
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function primarySuid(records: Array<{ suid: string }>): string {
  const suid = records[0]?.suid;
  if (!suid) throw new Error('The registration result did not include a Storage Provider record.');
  return suid;
}

function pendingAccountId(pending: PendingRegistration): string {
  return (pending.username || pending.email || '').trim();
}

async function makePasswordMetadata(input: {
  origin: string;
  uid: string;
  suid: string;
  counter: number;
  policy: PasswordPolicy;
}): Promise<DeterministicPasswordMetadata> {
  return {
    version: 1,
    algorithm: 'upspa-hkdf-sha256-policy-v1',
    origin: input.origin,
    uid: input.uid,
    suid: input.suid,
    counter: input.counter,
    policyHash: await passwordPolicyHash(input.policy),
    attempt: 0,
  };
}

async function encodeForAccount(input: {
  secretForLs: string;
  policy: PasswordPolicy;
  accountId: string;
  counter: number;
  origin: string;
  uid: string;
  suid: string;
  metadata?: DeterministicPasswordMetadata;
}): Promise<{ password: string; counter: number; metadata?: DeterministicPasswordMetadata }> {
  if (input.uid && input.suid) {
    const encoded = await encodePasswordDeterministically({
      vinfo: input.secretForLs,
      origin: input.origin,
      uid: input.uid,
      suid: input.suid,
      counter: input.counter,
      policy: input.policy,
    });
    return { password: encoded.password, counter: encoded.counter, metadata: encoded.metadata };
  }
  const encoded = await encodeSecretAsPassword(input.secretForLs, input.policy, input.accountId, input.counter);
  return { password: encoded.password, counter: encoded.counter };
}

function showAccountPicker(mode: PickerMode): void {
  pickerMode = mode;
  const site = requireActiveSite();
  const copy = mode === 'sign-in'
    ? ['Choose an account', 'Choose the account you want to use to sign in.']
    : mode === 'website-password-update'
      ? ['Update Saved Per-Site Secret', 'Choose the account whose encrypted Cj should be rebuilt from its current website password. The website will not be contacted.']
      : ['Saved accounts', 'Choose an account or add another account for this website.'];
  pickerTitleEl.textContent = copy[0];
  pickerDescriptionEl.textContent = copy[1];
  pickerContinueButton.textContent = mode === 'sign-in' ? 'Sign in with selected account' : mode === 'website-password-update' ? 'Update selected Cj' : 'Use selected account';
  pickerAccountsEl.innerHTML = '';

  if (!siteAccounts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-row';
    empty.textContent = 'No saved accounts for this website yet.';
    pickerAccountsEl.appendChild(empty);
    pickerContinueButton.disabled = true;
  } else {
    pickerContinueButton.disabled = false;
    const selected = selectedAccountId() || siteAccounts[0].accountId;
    siteAccountIdEl.value = selected;
    for (const account of siteAccounts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `saved-account-row${account.accountId === selected ? ' selected' : ''}`;
      button.dataset.accountId = account.accountId;
      const logo = document.createElement('span');
      logo.className = 'app-logo';
      logo.textContent = accountInitial(account.accountId);
      const details = document.createElement('span');
      details.className = 'saved-details';
      const primary = document.createElement('span');
      primary.textContent = account.label || account.accountId;
      const secondary = document.createElement('span');
      secondary.textContent = account.email || account.username || account.accountId;
      details.append(primary, secondary);
      button.append(logo, details);
      button.addEventListener('click', () => {
        siteAccountIdEl.value = account.accountId;
        showAccountPicker(pickerMode);
      });
      pickerAccountsEl.appendChild(button);
    }
  }
  void emit({ type: 'SCREEN_CHANGED', source: 'popup', screen: 'account-picker', reason: `${mode}:${site.id}` });
  showScreen('account-picker');
}

function renderDashboard(): void {
  const site = requireActiveSite();
  dashboardTitleEl.textContent = 'UpSPA dashboard';
  activeSiteSummaryEl.textContent = `${site.label} is supported by the local prototype registry.`;
  dashboardAccountsEl.innerHTML = '';
  if (!siteAccounts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-row';
    empty.textContent = 'No saved accounts for this website yet.';
    dashboardAccountsEl.appendChild(empty);
  } else {
    for (const account of siteAccounts) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'saved-account-row';
      row.dataset.accountId = account.accountId;
      const logo = document.createElement('span');
      logo.className = 'app-logo';
      logo.textContent = accountInitial(account.accountId);
      const details = document.createElement('span');
      details.className = 'saved-details';
      const primary = document.createElement('span');
      primary.textContent = account.label || account.accountId;
      const secondary = document.createElement('span');
      secondary.textContent = account.email || account.username || account.accountId;
      details.append(primary, secondary);
      row.append(logo, details);
      row.addEventListener('click', () => {
        siteAccountIdEl.value = account.accountId;
        showAccountPicker('dashboard');
      });
      dashboardAccountsEl.appendChild(row);
    }
  }
  showScreen('dashboard');
}

function showMasterAuth(accountId: string): void {
  const site = requireActiveSite();
  const account = siteAccounts.find((item) => item.accountId === accountId);
  if (!account) throw new Error('Choose one of this website\'s saved accounts first.');
  siteAccountIdEl.value = accountId;
  masterAuthSiteEl.textContent = site.label;
  masterAuthAccountEl.value = account.email || account.username || accountId;
  masterAuthPasswordEl.value = '';
  // Website sign-in is an explicit authentication action: always ask the user
  // to prove knowledge of the master password, even when other study flows can
  // reuse the temporary unlocked session.
  masterAuthPasswordFieldEl.classList.remove('hidden');
  showScreen('master-auth');
}

async function openLoginForAccount(accountId: string): Promise<void> {
  const site = requireActiveSite();
  await saveFlow('website-signin', 'master-auth', accountId);
  if (activePageKind !== 'login') {
    if (activeTabId === undefined) throw new Error('No active tab is available to open the login page.');
    await chrome.tabs.update(activeTabId, { url: site.loginUrl });
    setStatus('The website login page is opening. Reopen UpSPA there to enter the master password.');
    return;
  }
  showMasterAuth(accountId);
}

async function openSecretUpdateForAccount(accountId: string): Promise<void> {
  requireActiveSite();
  await saveFlow('website-password-update', 'password-settings', accountId);
  showSettings('website-password-update');
}

function showDetails(kind: 'website-signup' | 'import-existing-account'): void {
  const site = requireActiveSite();
  detailsSiteEl.textContent = site.label;
  siteAccountIdEl.value = currentFlow?.accountId || siteAccountIdEl.value;
  siteDetailsMasterPasswordEl.value = '';
  const isImport = kind === 'import-existing-account';
  detailsTitleEl.textContent = isImport ? 'Add an existing account' : 'Save Login Information';
  detailsDescriptionEl.textContent = isImport
    ? 'Enter the existing website account ID. UpSPA will import its current password entirely inside the extension; no website page will be opened or changed.'
    : 'Enter the website account ID first. UpSPA will fill it before asking once for your master password.';
  detailsMasterFieldEl.classList.add('hidden');
  detailsContinueButton.textContent = isImport ? 'Continue' : 'Fill account ID first';
  showScreen('site-account-details');
}

function showSettings(kind: 'website-signup' | 'import-existing-account' | 'website-password-update'): void {
  const site = requireActiveSite();
  const account = selectedAccount();
  const policy = account?.passwordPolicy ?? site.policy;
  const counter = account?.passwordCounter ?? account?.encoderCounter ?? currentEncoderCounter;
  renderPolicy(policy, counter);
  settingsMasterPasswordEl.value = '';
  settingsMasterFieldEl.classList.toggle('hidden', Boolean(transientMasterPassword));
  existingWebsitePasswordEl.value = '';
  candidatePasswordEl.value = '';
  candidateFieldEl.classList.add('hidden');
  const isImport = kind === 'import-existing-account';
  const isUpdate = kind === 'website-password-update';
  policyCardEl.classList.toggle('hidden', isImport || isUpdate);
  generateCandidateButton.classList.toggle('hidden', isImport || isUpdate);
  existingPasswordFieldEl.classList.toggle('hidden', !isImport && !isUpdate);
  settingsTitleEl.textContent = isUpdate ? 'Update Saved Per-Site Secret' : isImport ? 'Secure an existing account' : 'Password settings';
  settingsDescriptionEl.textContent = isUpdate
    ? 'Enter the current password for this website. UpSPA will rebuild and locally replace Cj with that exact password. It will not open, submit, or change anything on the website.'
    : isImport
      ? 'Enter the existing website password and your master password. The website password will be protected inside a new Cj and will not be replaced or sent to the website.'
      : 'On a staged form, click the website Continue button after the account ID is filled. Then enter the master password once and UpSPA will fill the password step.';
  settingsSubmitButton.textContent = isUpdate
    ? 'Replace encrypted Cj locally'
    : isImport
      ? 'Import existing password'
      : 'Generate and fill sign-up form';
  showScreen('site-password-settings');
}

function showWaiting(): void {
  waitingTitleEl.textContent = 'Waiting for account confirmation';
  waitingDescriptionEl.textContent = 'After the website confirms that your account was created, return here and confirm.';
  const canReuseMasterPassword = Boolean(transientMasterPassword);
  waitingDetailEl.textContent = canReuseMasterPassword
    ? 'UpSPA is unlocked in temporary extension-session memory for up to 30 minutes. Lock clears it immediately.'
    : 'The pending UpSPA material is encrypted. Enter the master password to unlock the confirmation step.';
  confirmationMasterPasswordEl.value = '';
  confirmationMasterFieldEl.classList.toggle('hidden', canReuseMasterPassword);
  confirmOperationButton.textContent = 'Account created';
  resumePendingFillButton.classList.remove('hidden');
  resumePendingFillButton.textContent = 'Fill website form again';
  showScreen('waiting-confirmation');
}

function showSuccess(title: string, description: string): void {
  successTitleEl.textContent = title;
  successDescriptionEl.textContent = description;
  showScreen('operation-success');
}

async function handleAuthenticate(): Promise<void> {
  requirePasswordCapableSite();
  const accountId = selectedAccountId();
  const account = await getAccountForOrigin(activeCredentialOrigin, accountId);
  const masterPassword = masterAuthPasswordEl.value;
  if (!account) throw new Error('Choose a saved website account first.');
  if (!masterPassword) throw new Error('Enter your master password.');

  await emit({ type: 'USER_REQUESTED_SITE_SIGNIN', source: 'popup', siteId: requireActiveSite().id, accountId });
  const recovered = await authenticateForSite(makeLsj(activeCredentialOrigin, accountId), masterPassword, account.uid);
  await unlockWithMasterPassword(masterPassword);
  const config = await getConfig();
  let websitePassword: string;
  if (recovered.kind === 'embedded-password') {
    websitePassword = recovered.password;
    if (account.credentialMode !== 'embedded-password') {
      await upsertAccountForOrigin(activeCredentialOrigin, { ...account, credentialMode: 'embedded-password' });
    }
  } else {
    if (!account.passwordPolicy || account.encoderCounter === undefined) {
      throw new Error('This derived credential is missing password-policy data. Enroll it again.');
    }
    const encoded = await encodeForAccount({
      secretForLs: recovered.secretForLs,
      policy: account.passwordPolicy,
      accountId,
      counter: account.passwordCounter ?? account.encoderCounter,
      origin: activeCredentialOrigin,
      uid: account.uid || config.uid,
      suid: account.suid || account.storageProviderSuids?.[0]?.suid || '',
      metadata: account.passwordMetadata,
    });
    websitePassword = encoded.password;
  }
  const flow = currentFlow?.kind === 'website-signin'
    ? await advanceFlow('filling', { accountId })
    : await saveFlow('website-signin', 'filling', accountId);
  await saveCredentialContinuation({
    kind: 'authentication',
    accountId,
    uid: account.uid || config.uid,
    passwordForLs: websitePassword,
  }, flow.flowId);
  const response = await fillOrThrow({
    type: 'UPSPA_FILL_LOGIN',
    payload: { uid: account.uid || config.uid, accountId, passwordForLs: websitePassword, overwrite: true },
  });
  await advanceFlow('waiting-for-password', { accountId });
  await emit({ type: 'ACCOUNT_SELECTED', source: 'popup', siteId: requireActiveSite().id, accountId, flowId: flow.flowId });
  await markSessionUsed();
  masterAuthPasswordEl.value = '';
  showSuccess('Website fields filled', `${describeFilled(response)} filled. Continue on the website; UpSPA will remember this account for the next login step.`);
}

async function prepareRegistration(): Promise<void> {
  const site = requirePasswordCapableSite();
  const accountId = selectedAccountId();
  const masterPassword = settingsMasterPasswordEl.value || transientMasterPassword;
  if (!accountId) throw new Error('Enter the website account ID.');
  if (!masterPassword) throw new Error('Enter your master password.');
  await emit({
    type: 'USER_REQUESTED_SITE_SIGNUP',
    source: 'popup',
    siteId: site.id,
  });
  const prepared = await prepareRegistrationForSite(makeLsj(activeCredentialOrigin, accountId), masterPassword);
  await unlockWithMasterPassword(masterPassword);
  const flow = currentFlow?.kind === 'website-signup'
    ? await advanceFlow('preparing', { accountId })
    : await saveFlow('website-signup', 'preparing', accountId);
  const policy = readPolicy();
  const suid = primarySuid(prepared.records);
  const pending = createPendingRegistrationSession({
    flowId: flow.flowId,
    origin: activeCredentialOrigin,
    websiteURL: activeWebsiteUrl || activeOrigin,
    uid: prepared.uid,
    suid,
    username: accountId.includes('@') ? undefined : accountId,
    email: accountId.includes('@') ? accountId : undefined,
    passwordPolicy: policy,
    counter: currentEncoderCounter,
    status: 'awaiting_confirmation',
    confirmationNonce: randomNonce(),
  });
  const encoded = await encodePasswordDeterministically({
    vinfo: prepared.passwordForLs,
    origin: pending.origin,
    uid: pending.uid,
    suid,
    counter: pending.counter,
    policy,
  });
  candidatePasswordEl.value = encoded.password;
  candidateFieldEl.classList.remove('hidden');

  await saveCredentialContinuation({
    kind: 'registration',
    accountId,
    uid: pending.uid,
    passwordForLs: encoded.password,
    flowId: pending.flowId,
    origin: activeOrigin,
    confirmationNonce: pending.confirmationNonce,
  }, flow.flowId);

  const response = await fillOrThrow({
    type: 'UPSPA_FILL_REGISTER',
    payload: {
      uid: pending.uid,
      accountId,
      passwordForLs: encoded.password,
      flowId: pending.flowId,
      origin: pending.origin,
      confirmationNonce: pending.confirmationNonce,
      overwrite: true,
    },
  });

  const pendingWithSecrets: PendingRegistration = {
    ...pending,
    username: pending.username || accountId,
    email: pending.email,
    passwordMetadata: encoded.metadata,
    counter: encoded.counter,
    passwordForLs: prepared.passwordForLs,
    records: prepared.records,
  };
  await savePendingRegistrationSession(
    pendingWithSecrets,
    { version: 1, passwordForLs: prepared.passwordForLs, records: prepared.records },
    masterPassword,
  );
  await advanceFlow('waiting-confirmation', { pendingOperationId: flow.flowId, accountId });
  await markSessionUsed();
  settingsMasterPasswordEl.value = '';
  existingWebsitePasswordEl.value = '';
  showWaiting();
  setStatus(`${describeFilled(response)} filled. Submit the website form manually, then confirm the website result here.`);
}

async function importExistingAccount(): Promise<void> {
  const site = requirePasswordCapableSite();
  const accountId = selectedAccountId();
  const masterPassword = settingsMasterPasswordEl.value || transientMasterPassword;
  const websitePassword = existingWebsitePasswordEl.value;
  if (!accountId) throw new Error('Enter the existing website account ID.');
  if (!masterPassword) throw new Error('Enter your master password.');
  if (!websitePassword) throw new Error('Enter the existing website password.');
  // Remove the website password from the form before any asynchronous work.
  // It remains only in this call and in the encrypted Cj created below.
  existingWebsitePasswordEl.value = '';
  if (await getAccountForOrigin(activeCredentialOrigin, accountId)) {
    throw new Error('This account is already saved. Use Update Saved Per-Site Secret instead.');
  }
  await emit({ type: 'USER_REQUESTED_ADD_EXISTING_ACCOUNT', source: 'popup', siteId: site.id });
  const prepared = await prepareMigrationForSite(
    makeLsj(activeCredentialOrigin, accountId),
    masterPassword,
    websitePassword,
  );
  await unlockWithMasterPassword(masterPassword);
  const flow = currentFlow?.kind === 'import-existing-account'
    ? await advanceFlow('committing', { accountId })
    : await saveFlow('import-existing-account', 'committing', accountId);
  await commitMigrationForSite(prepared);
  const suid = primarySuid(prepared.records);
  await upsertAccountForOrigin(activeCredentialOrigin, {
    accountId,
    version: 1,
    credentialMode: 'embedded-password',
    origin: activeCredentialOrigin,
    websiteURL: activeWebsiteUrl || activeOrigin,
    uid: prepared.uid,
    suid,
    username: accountId.includes('@') ? undefined : accountId,
    email: accountId.includes('@') ? accountId : undefined,
    createdAt: Math.floor(Date.now() / 1000),
    storageProviderSuids: prepared.records.map((record) => ({ sp_id: record.sp_id, suid: record.suid })),
  });
  await clearPendingRegistrationSession(flow.flowId);
  await clearCredentialContinuation(flow.flowId);
  await emit({ type: 'USER_CONFIRMED_EXISTING_ACCOUNT_IMPORTED', source: 'popup', flowId: flow.flowId });
  await clearFlowSession(flow.flowId);
  currentFlow = undefined;
  await markSessionUsed();
  settingsMasterPasswordEl.value = '';
  await loadAccounts(accountId);
  showSuccess(
    'Existing account imported',
    `The existing ${activeSite?.label ?? 'website'} password is protected inside Cj. UpSPA did not open or change the website.`,
  );
}

async function confirmRegistration(): Promise<void> {
  if (!currentFlow) throw new Error('No registration is waiting for confirmation.');
  const masterPassword = confirmationMasterPasswordEl.value || transientMasterPassword;
  if (!masterPassword) throw new Error('Enter your master password to unlock the pending registration.');
  const pending = await loadPendingRegistrationSession(activeCredentialOrigin, masterPassword);
  if (!pending || pending.flowId !== currentFlow.flowId || !pending.records?.length) {
    throw new Error('No matching registration is waiting for confirmation.');
  }
  await unlockWithMasterPassword(masterPassword);
  await commitRegistrationForSite({ uid: pending.uid, records: pending.records });
  const accountId = pendingAccountId(pending);
  if (!accountId) throw new Error('The pending registration is missing the website account ID.');
  const policy = pending.passwordPolicy ?? readPolicy();
  const suid = pending.suid ?? primarySuid(pending.records);
  await upsertAccountForOrigin(pending.origin, {
    accountId,
    version: 1,
    credentialMode: 'derived',
    origin: pending.origin,
    websiteURL: pending.websiteURL,
    uid: pending.uid,
    suid,
    username: pending.username,
    email: pending.email,
    createdAt: Math.floor(Date.now() / 1000),
    passwordPolicy: policy,
    passwordCounter: pending.counter,
    encoderCounter: pending.counter,
    passwordMetadata: pending.passwordMetadata ?? await makePasswordMetadata({ origin: pending.origin, uid: pending.uid, suid, counter: pending.counter, policy }),
    storageProviderSuids: pending.records.map((record) => ({ sp_id: record.sp_id, suid: record.suid })),
  });
  await clearPendingRegistrationSession(pending.flowId);
  await clearCredentialContinuation(pending.flowId);
  await emit({ type: 'USER_CONFIRMED_ACCOUNT_CREATED', source: 'popup', flowId: pending.flowId });
  await clearFlowSession(pending.flowId);
  currentFlow = undefined;
  confirmationMasterPasswordEl.value = '';
  await loadAccounts(accountId);
  showSuccess(
    'Website account saved',
    `Your ${activeSite?.label ?? 'website'} account was saved to this local study profile.`,
  );
}

async function prepareWebsitePasswordUpdate(): Promise<void> {
  const site = requirePasswordCapableSite();
  const accountId = selectedAccountId();
  const account = await getAccountForOrigin(activeCredentialOrigin, accountId);
  const masterPassword = settingsMasterPasswordEl.value || transientMasterPassword;
  if (!account) {
    throw new Error('Choose an enrolled website account before updating its saved per-site secret.');
  }
  if (!masterPassword) throw new Error('Enter your master password.');
  const currentWebsitePassword = existingWebsitePasswordEl.value;
  if (!currentWebsitePassword) throw new Error('Enter the current website password.');
  existingWebsitePasswordEl.value = '';
  await emit({ type: 'USER_REQUESTED_WEBSITE_RECORD_REFRESH', source: 'popup', siteId: site.id, accountId });
  const prepared = await prepareSecretUpdateForSite(
    makeLsj(activeCredentialOrigin, accountId),
    masterPassword,
    currentWebsitePassword,
    account.uid,
  );
  await unlockWithMasterPassword(masterPassword);
  const flow = currentFlow?.kind === 'website-password-update'
    ? await advanceFlow('preparing', { accountId })
    : await saveFlow('website-password-update', 'preparing', accountId);
  await commitSecretUpdateForSite({ uid: prepared.uid, cjNew: prepared.cjNew, suids: prepared.suids });
  await upsertAccountForOrigin(activeCredentialOrigin, { ...account, credentialMode: 'embedded-password' });
  await clearPendingSecretUpdateSession();
  await clearCredentialContinuation(flow.flowId);
  await emit({ type: 'USER_CONFIRMED_WEBSITE_RECORD_REFRESHED', source: 'popup', flowId: flow.flowId });
  await clearFlowSession(flow.flowId);
  currentFlow = undefined;
  await markSessionUsed();
  settingsMasterPasswordEl.value = '';
  existingWebsitePasswordEl.value = '';
  await loadAccounts(accountId);
  showSuccess(
    'Encrypted Cj replaced',
    `UpSPA rebuilt the encrypted Cj for ${activeSite?.label ?? 'this website'} with the entered current website password. No website interaction occurred.`,
  );
}

async function resumePendingFill(): Promise<void> {
  if (!currentFlow) throw new Error('No active flow is available to resume.');
  if (currentFlow.kind !== 'website-signup') throw new Error('This flow cannot refill a website form.');
  const masterPassword = confirmationMasterPasswordEl.value || transientMasterPassword;
  if (!masterPassword) throw new Error('Enter the master password to unlock the prepared registration.');
  const pending = await loadPendingRegistrationSession(activeCredentialOrigin, masterPassword);
  if (!pending || pending.flowId !== currentFlow.flowId || !pending.passwordForLs || !pending.records?.length) {
    throw new Error('No matching prepared registration is available to refill.');
  }
  await unlockWithMasterPassword(masterPassword);
  const accountId = pendingAccountId(pending);
  const policy = pending.passwordPolicy ?? readPolicy();
  const suid = pending.suid ?? primarySuid(pending.records);
  const encoded = await encodePasswordDeterministically({
    vinfo: pending.passwordForLs,
    origin: pending.origin,
    uid: pending.uid,
    suid,
    counter: pending.counter,
    policy,
  });
  const response = await fillOrThrow({
    type: 'UPSPA_FILL_REGISTER',
    payload: {
      uid: pending.uid,
      accountId,
      passwordForLs: encoded.password,
      flowId: pending.flowId,
      origin: activeOrigin,
      confirmationNonce: pending.confirmationNonce,
      overwrite: true,
    },
  });
  confirmationMasterPasswordEl.value = '';
  setStatus(`${describeFilled(response)} filled again. Continue on the website, then confirm only after it accepts the account.`);
}

async function handleDetailsContinue(): Promise<void> {
  const kind = currentFlow?.kind;
  const accountId = siteAccountIdEl.value.trim();
  if (!accountId) throw new Error('Enter the website account ID.');
  if (kind !== 'website-signup' && kind !== 'import-existing-account') throw new Error('Start a website account flow first.');
  if (kind === 'website-signup') {
    const response = await fillOrThrow({
      type: 'UPSPA_FILL_IDENTITY',
      payload: { accountId, overwrite: true },
    });
    await advanceFlow('password-settings', { accountId });
    showSettings(kind);
    setStatus(`${describeFilled(response)} filled. If this is a two-stage form, click the website Continue button before preparing the password.`);
    return;
  }
  await advanceFlow('password-settings', { accountId });
  showSettings(kind);
}

async function beginMasterPasswordUpdate(): Promise<void> {
  await emit({ type: 'USER_REQUESTED_MASTER_PASSWORD_UPDATE', source: 'popup' });
  await saveFlow('master-password-update', 'verify-current');
  masterUpdateState = undefined;
  masterCurrentPasswordEl.value = '';
  masterCurrentPasswordFieldEl.classList.toggle('hidden', Boolean(transientMasterPassword));
  showScreen('master-password-current');
  setStatus(transientMasterPassword
    ? 'The extension session is already unlocked. Continue to choose a new master password.'
    : 'Verify your current master password to continue.');
}

async function verifyMasterPassword(): Promise<void> {
  const currentPassword = masterCurrentPasswordEl.value || transientMasterPassword;
  if (!currentPassword) throw new Error('Enter your current master password.');
  const accounts = await getAllSiteAccounts();
  const verificationAccount = accounts.find((account) => Boolean(account.origin && account.accountId));
  if (!verificationAccount?.origin) {
    throw new Error('Add at least one website account before updating the master password so UpSPA can verify it.');
  }
  await authenticateForSite(
    makeLsj(verificationAccount.origin, verificationAccount.accountId),
    currentPassword,
    verificationAccount.uid,
  );
  await unlockWithMasterPassword(currentPassword);
  masterUpdateState = { currentPassword };
  await advanceFlow('new-password');
  masterCurrentPasswordEl.value = '';
  showScreen('master-password-new');
}

async function continueMasterPasswordUpdate(): Promise<void> {
  if (!masterUpdateState) throw new Error('Verify your current master password again.');
  const nextPassword = masterNewPasswordEl.value;
  if (!meetsMasterPasswordLength(nextPassword)) {
    throw new Error(`Choose a master password with at least ${MIN_MASTER_PASSWORD_LENGTH} characters.`);
  }
  if (nextPassword !== masterNewPasswordConfirmEl.value) throw new Error('The new master password fields do not match.');
  if (nextPassword === masterUpdateState.currentPassword) throw new Error('Choose a different master password.');
  masterUpdateState.newPassword = nextPassword;
  masterNewPasswordEl.value = '';
  masterNewPasswordConfirmEl.value = '';
  masterChecklistPersonalEl.checked = false;
  masterChecklistUniqueEl.checked = false;
  masterChecklistSafeEl.checked = false;
  await advanceFlow('checklist');
  showScreen('master-password-checklist');
}

async function commitMasterPasswordUpdate(): Promise<void> {
  if (!masterUpdateState?.newPassword) throw new Error('Verify the current master password and choose a new password again.');
  if (!masterChecklistPersonalEl.checked || !masterChecklistUniqueEl.checked || !masterChecklistSafeEl.checked) {
    throw new Error('Complete each checklist item before updating the master password.');
  }
  const newMasterPassword = masterUpdateState.newPassword;
  await passwordUpdateDirect(masterUpdateState.currentPassword, newMasterPassword);
  await clearSession();
  await unlockWithMasterPassword(newMasterPassword);
  await markSessionUsed();
  if (currentFlow) await clearFlowSession(currentFlow.flowId);
  currentFlow = undefined;
  masterUpdateState = undefined;
  showScreen('master-password-success');
}

async function cancelCurrentFlow(): Promise<void> {
  if (currentFlow?.kind === 'website-signup') {
    await clearPendingRegistrationSession(currentFlow.flowId);
  }
  if (currentFlow?.kind === 'website-password-update') {
    await clearPendingSecretUpdateSession(currentFlow.flowId);
  }
  const flowId = currentFlow?.flowId;
  await clearCredentialContinuation(flowId);
  await clearFlowSession(flowId);
  await emit({ type: 'FLOW_CANCELLED', source: 'popup', flowId });
  currentFlow = undefined;
  masterUpdateState = undefined;
  existingWebsitePasswordEl.value = '';
  candidatePasswordEl.value = '';
  await routeFromPage();
}

async function routeFromPage(): Promise<void> {
  if (!activeSite) {
    unsupportedMessageEl.textContent = 'This page is not in the 40-site UpSPA prototype registry.';
    showScreen('unsupported');
    return;
  }
  if (activeSite.credentialMode === 'passwordless') {
    unsupportedMessageEl.textContent = `${activeSite.label} uses passwordless email/social sign-in and has no password field for UpSPA to generate or autofill. Keep it only as a detection case, or replace it with a conventional password site for the study.`;
    showScreen('unsupported');
    return;
  }
  if (activePageKind === 'login') {
    if (siteAccounts.length > 1) {
      await saveFlow('website-signin', 'account-picker');
      showAccountPicker('sign-in');
      return;
    }
    if (siteAccounts.length === 1) {
      await saveFlow('website-signin', 'master-auth', siteAccounts[0].accountId);
      showMasterAuth(siteAccounts[0].accountId);
      return;
    }
    showScreen('add-account-choice');
    return;
  }
  if (activePageKind === 'sign-up') {
    await saveFlow('website-signup', 'details');
    showDetails('website-signup');
    return;
  }
  if (activePageKind === 'password-change') {
    if (siteAccounts.length > 1) {
      await saveFlow('website-password-update', 'account-picker');
      showAccountPicker('website-password-update');
      return;
    }
    if (siteAccounts.length === 1) {
      await saveFlow('website-password-update', 'password-settings', siteAccounts[0].accountId);
      showSettings('website-password-update');
      return;
    }
    showScreen('add-account-choice');
    setStatus('No enrolled account exists for this website. Add an existing account or create a new one first.');
    return;
  }
  renderDashboard();
}

async function restoreOrRoute(): Promise<void> {
  const restored = await restoreFlowSession({ siteId: activeSite?.id, tabId: activeTabId });
  if (!restored) {
    await routeFromPage();
    return;
  }
  currentFlow = restored;
  if (restored.accountId) siteAccountIdEl.value = restored.accountId;
  await emit({ type: 'FLOW_RESTORED', source: 'popup', flowId: restored.flowId, kind: restored.kind, stage: restored.stage });
  if (restored.kind === 'master-password-update') {
    masterUpdateState = undefined;
    masterCurrentPasswordEl.value = '';
    masterCurrentPasswordFieldEl.classList.toggle('hidden', Boolean(transientMasterPassword));
    showScreen('master-password-current');
    setStatus(transientMasterPassword
      ? 'The extension session is unlocked. Verify and continue to choose a new master password.'
      : 'Verify your current master password again to continue this update.');
    return;
  }
  if (restored.kind === 'website-signup') {
    const pending = await loadPendingRegistrationSession(activeCredentialOrigin);
    if (pending?.flowId === restored.flowId) {
      showWaiting();
      return;
    }
    showDetails('website-signup');
    return;
  }
  if (restored.kind === 'import-existing-account') {
    if (restored.accountId) showSettings('import-existing-account');
    else showDetails('import-existing-account');
    return;
  }
  if (restored.kind === 'website-password-update') {
    // Older builds could leave a pending website-change transaction. The
    // corrected flow has no website submission or confirmation stage.
    await clearPendingSecretUpdateSession();
    await clearCredentialContinuation(restored.flowId);
    showSettings('website-password-update');
    return;
  }
  if (restored.kind === 'website-signin' && restored.accountId) {
    showMasterAuth(restored.accountId);
    return;
  }
  renderDashboard();
}

async function initialize(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  activeTabId = tab?.id;
  activeWebsiteUrl = tab?.url ?? '';
  activeOrigin = '';
  activeCredentialOrigin = '';
  activeSite = undefined;
  activePageKind = 'unsupported';
  activeFormFrameId = undefined;
  if (!(await isSetupComplete())) {
    showScreen('setup-required');
    setStatus('Finish extension setup before using website credentials. Setup can be started from any browser page.');
    return;
  }
  transientMasterPassword = (await loadMasterPasswordFromSession()) ?? '';
  try {
    activeOrigin = getActiveOrigin(activeWebsiteUrl);
  } catch (error) {
    unsupportedMessageEl.textContent = error instanceof Error ? error.message : String(error);
    showScreen('unsupported');
    return;
  }
  const classification = classifyPage(activeWebsiteUrl);
  activeSite = classification.site;
  activePageKind = classification.kind;
  if (activeSite) activeCredentialOrigin = getCredentialOrigin(activeSite, activeOrigin);
  if (activeSite && activeTabId !== undefined) {
    const pageContext = await loadFreshPageContext();
    if (pageContext) {
      activePageKind = applyDetectedFormFallback(activePageKind, pageContext.formType);
      if (pageContext.formType !== 'unknown') {
        activeWebsiteUrl = pageContext.url;
        activeOrigin = pageContext.origin;
        activeSite = classifyPage(pageContext.url).site ?? activeSite;
        activeCredentialOrigin = getCredentialOrigin(activeSite, activeOrigin);
      }
    }
  }
  await emit({
    type: 'PAGE_CLASSIFIED',
    source: 'popup',
    url: activeWebsiteUrl,
    origin: activeOrigin,
    siteId: activeSite?.id,
    pageKind: activePageKind,
  });
  if (!activeSite) {
    unsupportedMessageEl.textContent = `${new URL(activeWebsiteUrl).hostname} is not in the 40-site UpSPA prototype registry.`;
    showScreen('unsupported');
    return;
  }
  await loadAccounts();
  await restoreOrRoute();
}

function scheduleNavigationRefresh(delayMs = 220): void {
  if (navigationRefreshTimer !== undefined) window.clearTimeout(navigationRefreshTimer);
  navigationRefreshTimer = window.setTimeout(() => {
    navigationRefreshTimer = undefined;
    if (isBusy) {
      scheduleNavigationRefresh(delayMs);
      return;
    }
    void run(initialize);
  }, delayMs);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== activeTabId) return;
  if (changeInfo.url || changeInfo.status === 'complete') scheduleNavigationRefresh();
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  scheduleNavigationRefresh(80);
});

byId<HTMLButtonElement>('openSetup').addEventListener('click', () => void run(async () => {
  await emit({ type: 'USER_REQUESTED_SETUP', source: 'popup' });
  if (/^https?:\/\//i.test(activeWebsiteUrl)) {
    await chrome.storage.local.set({ [SETUP_RETURN_URL_KEY]: activeWebsiteUrl });
  }
  chrome.runtime.openOptionsPage();
}));

byId<HTMLButtonElement>('dashboardSignIn').addEventListener('click', () => void run(async () => {
  if (siteAccounts.length > 1) {
    await saveFlow('website-signin', 'account-picker');
    showAccountPicker('sign-in');
  } else if (siteAccounts[0]) {
    await openLoginForAccount(siteAccounts[0].accountId);
  }
}));
byId<HTMLButtonElement>('dashboardUpdateWebsitePassword').addEventListener('click', () => void run(async () => {
  if (siteAccounts.length > 1) {
    await saveFlow('website-password-update', 'account-picker');
    showAccountPicker('website-password-update');
  } else if (siteAccounts[0]) {
    await openSecretUpdateForAccount(siteAccounts[0].accountId);
  }
}));
byId<HTMLButtonElement>('dashboardAddAccount').addEventListener('click', () => showScreen('add-account-choice'));
byId<HTMLButtonElement>('dashboardMasterPassword').addEventListener('click', () => void run(beginMasterPasswordUpdate));
byId<HTMLButtonElement>('pickerAddAccount').addEventListener('click', () => showScreen('add-account-choice'));
byId<HTMLButtonElement>('pickerMasterPassword').addEventListener('click', () => void run(beginMasterPasswordUpdate));
byId<HTMLButtonElement>('railAddAccount').addEventListener('click', () => showScreen('add-account-choice'));
byId<HTMLButtonElement>('railSavedAccounts').addEventListener('click', () => void run(async () => {
  if (!activeSite) return;
  await loadAccounts();
  renderDashboard();
}));
pickerContinueButton.addEventListener('click', () => void run(async () => {
  const accountId = siteAccountIdEl.value.trim();
  if (!accountId) throw new Error('Choose an account first.');
  const site = requireActiveSite();
  await emit({ type: 'ACCOUNT_SELECTED', source: 'popup', siteId: site.id, accountId, flowId: currentFlow?.flowId });
  if (pickerMode === 'sign-in') {
    await openLoginForAccount(accountId);
  } else if (pickerMode === 'website-password-update') {
    await openSecretUpdateForAccount(accountId);
  } else {
    renderDashboard();
  }
}));

createNewAccountButton.addEventListener('click', () => void run(async () => {
  const site = requireActiveSite();
  if (site.registrationSupported === false) {
    throw new Error(`${site.label} does not support website registration. Import an existing account instead.`);
  }
  await emit({ type: 'USER_REQUESTED_SITE_SIGNUP', source: 'popup', siteId: site.id });
  await saveFlow('website-signup', 'details');
  if (activeTabId !== undefined) await chrome.tabs.update(activeTabId, { url: site.signupUrl });
  showDetails('website-signup');
}));
byId<HTMLButtonElement>('addExistingAccount').addEventListener('click', () => void run(async () => {
  const site = requireActiveSite();
  await emit({ type: 'ADD_ANOTHER_ACCOUNT_SELECTED', source: 'popup', siteId: site.id, flowId: currentFlow?.flowId });
  await saveFlow('import-existing-account', 'details');
  showDetails('import-existing-account');
}));
byId<HTMLButtonElement>('choiceBack').addEventListener('click', () => void run(routeFromPage));
byId<HTMLButtonElement>('detailsContinue').addEventListener('click', () => void run(handleDetailsContinue));
byId<HTMLButtonElement>('detailsCancel').addEventListener('click', () => void run(cancelCurrentFlow));
byId<HTMLButtonElement>('authenticate').addEventListener('click', () => void run(handleAuthenticate));
byId<HTMLButtonElement>('masterAuthAddAccount').addEventListener('click', () => showScreen('add-account-choice'));
settingsSubmitButton.addEventListener('click', () => void run(async () => {
  if (currentFlow?.kind === 'website-password-update') await prepareWebsitePasswordUpdate();
  else if (currentFlow?.kind === 'import-existing-account') await importExistingAccount();
  else if (currentFlow?.kind === 'website-signup') await prepareRegistration();
  else throw new Error('Start a website account or password-update flow first.');
}));
generateCandidateButton.addEventListener('click', () => {
  currentEncoderCounter += 1;
  renderPolicy(readPolicy(), currentEncoderCounter);
  setStatus('The next prepared website password will use a new compatible candidate.');
});
byId<HTMLButtonElement>('settingsCancel').addEventListener('click', () => void run(cancelCurrentFlow));
confirmOperationButton.addEventListener('click', () => void run(async () => {
  if (currentFlow?.kind === 'website-signup') await confirmRegistration();
  else throw new Error('No operation is waiting for confirmation.');
}));
resumePendingFillButton.addEventListener('click', () => void run(resumePendingFill));
byId<HTMLButtonElement>('cancelOperation').addEventListener('click', () => void run(cancelCurrentFlow));
byId<HTMLButtonElement>('successDone').addEventListener('click', () => void run(routeFromPage));
byId<HTMLButtonElement>('verifyMasterPassword').addEventListener('click', () => void run(verifyMasterPassword));
byId<HTMLButtonElement>('masterUpdateCancel').addEventListener('click', () => void run(cancelCurrentFlow));
byId<HTMLButtonElement>('masterNewContinue').addEventListener('click', () => void run(continueMasterPasswordUpdate));
byId<HTMLButtonElement>('masterUpdateCommit').addEventListener('click', () => void run(commitMasterPasswordUpdate));
byId<HTMLButtonElement>('masterChecklistBack').addEventListener('click', () => showScreen('master-password-new'));
byId<HTMLButtonElement>('masterSuccessDone').addEventListener('click', () => void run(routeFromPage));
byId<HTMLButtonElement>('lockSession').addEventListener('click', () => void run(async () => {
  await cancelCurrentFlow();
  await clearSession();
  transientMasterPassword = '';
  masterAuthPasswordEl.value = '';
  settingsMasterPasswordEl.value = '';
  existingWebsitePasswordEl.value = '';
  candidatePasswordEl.value = '';
  confirmationMasterPasswordEl.value = '';
  masterCurrentPasswordEl.value = '';
  setStatus('Extension session locked and transient flow state cleared.');
}));

initialize().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), 'error');
  showScreen('error');
});
