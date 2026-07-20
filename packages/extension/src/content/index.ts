// @ts-nocheck
import { publishChromeExtensionEvent } from '../shared/events/chromeEventBridge';
import { makeExtensionEvent } from '../shared/events/extensionEvents';
import { classifyPage } from '../shared/pageClassifier';
import { getSupportedSiteForUrl } from '../shared/supportedSites';
import {
  deepActiveElement,
  observeDeepMutations,
  querySelectorAllDeep,
  querySelectorDeep,
} from '../shared/deepDom';
import { startPrototypeFormWatcher } from './prototypeFormWatcher';

const TEXT_INPUT_SELECTOR = [
  'input:not([type])',
  'input[type="text"]',
  'input[type="email"]',
  'input[type="tel"]',
].join(', ');

const POLICY_ATTR_CANDIDATES = [
  'passwordrules',
  'data-passwordrules',
  'data-password-rules',
  'data-rule-password',
  'data-rule-pattern',
];

const MIN_ATTR_CANDIDATES = [
  'minlength',
  'data-minlength',
  'data-min-length',
  'data-password-min',
  'data-rule-minlength',
  'data-val-length-min',
];

const MAX_ATTR_CANDIDATES = [
  'maxlength',
  'data-maxlength',
  'data-max-length',
  'data-password-max',
  'data-rule-maxlength',
  'data-val-length-max',
];

const SYMBOL_CHARS = '!@#$%^&*()_+-=[]{}|;:\\",.<>/?`~\'';
const DEFAULT_SYMBOLS = '!@#$%^&*';
const CONTINUATION_TTL_MS = 30 * 60 * 1000;
const NEGATIVE_FIELD_HINT =
  /\b(?:otp|2fa|mfa|totp|token|captcha|verification|verify|code|passcode|pin|search|query|filter|coupon|promo|zip|postal|address|city|country|card|credit|cc|cvc|cvv|expiry|expiration|amount|quantity|security\s+(?:question|answer)|challenge\s+(?:question|answer)|recovery\s+(?:code|key|answer))\b/;
const NON_PASSWORD_CHALLENGE_HINT =
  /\b(?:otp|2fa|mfa|totp|one[\s-]*time(?:\s+(?:password|passcode|code))?|verification(?:\s+(?:password|passcode|code))?|verify(?:\s+(?:password|passcode|code))?|auth(?:entication)?\s+code|security\s+code|passcode|pin|token|security\s+(?:question|answer)|challenge\s+(?:question|answer)|recovery\s+(?:code|key|answer))\b/;

function startWatcherWhenReady() {
  const start = () => {
    startPrototypeFormWatcher({
      emit: async (event) => {
        await publishChromeExtensionEvent(event);
        if (event.type === 'FORM_DETECTED' || event.type === 'PAGE_CLASSIFIED') {
          scheduleCredentialContinuation();
        }
      },
      debounceMs: 100,
    });
    scheduleCredentialContinuation(0);
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

let activeCredentialContinuation;
let continuationResumeTimer;
let continuationResumeInFlight = false;
let lastContinuationSignature = '';

function rememberCredentialContinuation(material) {
  const site = activePrototypeSite();
  if (!site) return undefined;
  const sourceUrl = getSupportedSiteForUrl(location.href) ? location.href : document.referrer;
  let origin = location.origin;
  try {
    if (sourceUrl) origin = new URL(sourceUrl).origin;
  } catch {
    // Keep the current origin; validation will reject an unsupported value.
  }
  activeCredentialContinuation = {
    version: 1,
    flowId: material.flowId,
    kind: material.kind,
    siteId: site.id,
    origin,
    expectedStage: material.kind === 'authentication' || material.kind === 'registration'
      ? 'identity-or-password'
      : 'password-change',
    createdAt: Date.now(),
    expiresAt: Date.now() + CONTINUATION_TTL_MS,
    material,
  };
  lastContinuationSignature = '';
  return activeCredentialContinuation;
}

async function loadCredentialContinuationForPage() {
  const site = activePrototypeSite();
  if (!site) return undefined;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'UPSPA_GET_CREDENTIAL_CONTINUATION',
      siteId: site.id,
    });
    if (response?.ok && response.continuation) {
      activeCredentialContinuation = response.continuation;
      return response.continuation;
    }
  } catch {
    // A waking service worker may miss the first request; the next form event retries it.
  }
  return activeCredentialContinuation;
}

async function advanceActiveCredentialContinuation(continuation, expectedStage) {
  if (!continuation) return;
  continuation.expectedStage = expectedStage;
  activeCredentialContinuation = continuation;
  lastContinuationSignature = '';
  try {
    await chrome.runtime.sendMessage({
      type: 'UPSPA_ADVANCE_CREDENTIAL_CONTINUATION',
      siteId: continuation.siteId,
      flowId: continuation.flowId,
      expectedStage,
    });
  } catch {
    // The in-page stage still prevents unsafe retries if the worker is waking.
  }
}

async function consumeActiveCredentialContinuation(continuation) {
  if (!continuation) return;
  activeCredentialContinuation = undefined;
  lastContinuationSignature = '';
  try {
    await chrome.runtime.sendMessage({
      type: 'UPSPA_CLEAR_CREDENTIAL_CONTINUATION',
      siteId: continuation.siteId,
      flowId: continuation.flowId,
    });
  } catch {
    // The local copy is consumed even if the worker cannot be reached immediately.
  }
}

function credentialFormSignature() {
  const inputs = querySelectorAllDeep('input')
    .filter((input) => input instanceof HTMLInputElement && isVisibleEditableInput(input))
    .map((input) => [input.type, input.id, input.name, input.autocomplete, Boolean(input.value)].join(':'));
  return `${location.href}|${inputs.join('|')}`;
}

function continuationSourceUrl() {
  return getSupportedSiteForUrl(location.href) ? location.href : document.referrer || location.href;
}

function continuationOriginMatchesSite(continuation, site) {
  if (!continuation?.origin || !site) return false;
  return getSupportedSiteForUrl(continuation.origin)?.id === site.id;
}

function continuationOperationIntent(input) {
  if (!input) return 'unknown';
  const root = input.closest('dialog, [role="dialog"], form, [role="form"], section, article, main')
    || input.getRootNode();
  const heading = querySelectorDeep('h1, h2, h3, [role="heading"], [aria-level]', root);
  const submit = querySelectorDeep('button[type="submit"], input[type="submit"], button:not([type]), [role="button"]', root);
  const text = cleanText([
    visibleText(heading),
    root instanceof Element ? root.id : '',
    root instanceof Element ? root.getAttribute('name') || '' : '',
    root instanceof Element ? root.getAttribute('aria-label') || '' : '',
    submit instanceof HTMLInputElement ? submit.value : visibleText(submit),
  ].join(' ')).toLowerCase();
  if (/\b(?:change|update|reset)\s+(?:your\s+)?password\b|\bnew\s+password\b/.test(text)) return 'password-update';
  if (/\b(?:sign\s*up|signup|create\s+(?:an?\s+)?account|create\s+(?:a\s+)?password|register|registration|join)\b/.test(text)) return 'register';
  if (/\b(?:log\s*in|login|sign\s*in|signin|welcome\s+back|enter\s+(?:your\s+)?password)\b/.test(text)) return 'login';
  return 'unknown';
}

function hintedPasswordInputs(site, mode) {
  const selectors = mode === 'register'
    ? [...(site.fieldHints?.newPassword || []), ...(site.fieldHints?.password || [])]
    : site.fieldHints?.password;
  return queryAllVisibleInputs(selectors).filter((input) => passwordInputEligibleForMode(input, mode));
}

function continuationTarget(continuation, site) {
  const material = continuation?.material;
  if (!material || !continuationOriginMatchesSite(continuation, site)) return null;
  const expectedStage = continuation.expectedStage
    || (material.kind === 'authentication' || material.kind === 'registration'
      ? 'identity-or-password'
      : 'password-change');

  let input = null;
  let stage = 'identity';
  let expectedOperation = 'password-update';
  if (material.kind === 'authentication') {
    expectedOperation = 'login';
    const passwords = hintedPasswordInputs(site, 'login');
    input = passwords[0] || choosePasswordInputs('login')[0] || null;
    if (input) stage = 'password';
    else if (expectedStage === 'identity-or-password') {
      input = queryFirst(site.fieldHints?.username) || findUsernameInput(null);
    }
  } else if (material.kind === 'registration') {
    expectedOperation = 'register';
    const passwords = hintedPasswordInputs(site, 'register');
    input = passwords[0] || choosePasswordInputs('register')[0] || null;
    if (input) stage = 'password';
    else if (expectedStage === 'identity-or-password') {
      input = queryFirst(site.fieldHints?.registrationUsername)
        || queryFirst(site.fieldHints?.email)
        || queryFirst(site.fieldHints?.username)
        || findUsernameInput(null);
    }
  } else {
    const namedOld = queryFirstSafePassword(site.fieldHints?.oldPassword, 'change-old')
      || queryPasswordUpdateField('old');
    const namedNew = queryFirstSafePassword(site.fieldHints?.newPassword, 'change-new')
      || queryPasswordUpdateField('new', namedOld || undefined);
    const passwordInputs = getVisiblePasswordInputs();
    if (expectedStage === 'new-password') {
      input = namedNew
        || passwordInputs.find((candidate) => scorePasswordInput(candidate, 'change-new') > 0)
        || null;
      stage = 'new-password';
    } else {
      input = namedNew || namedOld || passwordInputs[0] || null;
      stage = namedNew ? 'new-password' : 'password-change';
    }
  }
  if (!input) return null;
  if (expectedStage === 'password' && stage !== 'password') return null;

  const pageKind = classifyPage(continuationSourceUrl()).kind;
  if (pageKind === 'unsupported') return null;
  const expectedPageKind = expectedOperation === 'login'
    ? 'login'
    : expectedOperation === 'register'
      ? 'sign-up'
      : 'password-change';
  if (pageKind === 'login' || pageKind === 'sign-up' || pageKind === 'password-change') {
    if (pageKind !== expectedPageKind) return null;
  } else if (pageKind === 'auth-choice') {
    if (expectedOperation === 'password-update') return null;
    const operationIntent = continuationOperationIntent(input);
    if (operationIntent !== 'unknown' && operationIntent !== expectedOperation) return null;
  } else if (continuationOperationIntent(input) !== expectedOperation) {
    return null;
  }
  return { input, stage, expectedOperation };
}

async function settleCredentialContinuation(continuation, result) {
  if (!continuation || !result?.ok) return;
  const material = continuation.material;
  if (material.kind === 'authentication' || material.kind === 'registration') {
    if (result.filled.passwords > 0) {
      await consumeActiveCredentialContinuation(continuation);
    } else if (result.filled.username) {
      await advanceActiveCredentialContinuation(continuation, 'password');
    }
    return;
  }
  if (result.passwordStage === 'new-password') {
    await consumeActiveCredentialContinuation(continuation);
  } else if (result.filled.passwords > 0) {
    await advanceActiveCredentialContinuation(continuation, 'new-password');
  }
}

async function resumeCredentialContinuation() {
  if (continuationResumeInFlight) return;
  continuationResumeInFlight = true;
  try {
    const site = activePrototypeSite();
    if (!site) return;
    let continuation = activeCredentialContinuation;
    if (!continuation || continuation.siteId !== site.id || continuation.expiresAt <= Date.now()) {
      continuation = await loadCredentialContinuationForPage();
    }
    const material = continuation?.material;
    const target = continuation && continuation.siteId === site.id
      ? continuationTarget(continuation, site)
      : null;
    if (!continuation || !material || !target) return;

    const signature = credentialFormSignature();
    if (signature === lastContinuationSignature) return;
    lastContinuationSignature = signature;

    let result;
    if (material.kind === 'authentication') {
      result = await fillLogin(material.accountId, material.passwordForLs, material.uid, true);
    } else if (material.kind === 'registration') {
      result = await fillRegister(
        material.accountId,
        material.passwordForLs,
        material.uid,
        {
          flowId: material.flowId,
          origin: material.origin,
          confirmationNonce: material.confirmationNonce,
        },
        true,
      );
    } else {
      result = await fillPasswordChange(
        material.oldPasswordForLs,
        material.newPasswordForLs,
        true,
        continuation.expectedStage,
      );
    }

    if (result?.ok) {
      await settleCredentialContinuation(continuation, result);
      await publishChromeExtensionEvent(makeExtensionEvent({
        type: 'FILL_ATTEMPTED',
        source: 'content',
        formType: material.kind === 'authentication'
          ? 'login'
          : material.kind === 'registration'
            ? 'register'
            : 'password-update',
        usernameFilled: result.filled.username,
        passwordFieldsFilled: result.filled.passwords,
      }));
    }
  } finally {
    continuationResumeInFlight = false;
  }
}

function scheduleCredentialContinuation(delayMs = 120) {
  if (continuationResumeTimer !== undefined) window.clearTimeout(continuationResumeTimer);
  continuationResumeTimer = window.setTimeout(() => {
    void resumeCredentialContinuation();
  }, delayMs);
}

window.addEventListener('pageshow', () => scheduleCredentialContinuation(0));
window.addEventListener('popstate', () => scheduleCredentialContinuation(0));
window.addEventListener('hashchange', () => scheduleCredentialContinuation(0));

startWatcherWhenReady();

function classifyFocusedField(input) {
  if (!(input instanceof HTMLInputElement)) return 'unknown';
  if (input.type === 'password') return 'password';
  if (isSearchLikeInput(input)) return 'unknown';
  const descriptor = cleanText([
    input.id,
    input.name,
    input.autocomplete,
    input.placeholder,
    input.getAttribute('aria-label') || '',
  ].join(' ')).toLowerCase();
  if (input.type === 'email' || /\b(?:email|e-mail|user|username|login|account)\b/.test(descriptor)) {
    return 'username';
  }
  return 'unknown';
}

function isPrototypeCredentialField(target) {
  if (!(target instanceof HTMLInputElement)) return false;
  if (!isVisibleEditableInput(target)) return false;
  if (target.type === 'password') return true;
  return classifyFocusedField(target) === 'username';
}

let launcherHost;
let launcher;
let launcherTarget;
let launcherTracking = false;
let embeddedPanelHost;
let removeEmbeddedPanelKeyHandler;

function closeEmbeddedPanel() {
  if (!embeddedPanelHost) return;
  embeddedPanelHost.remove();
  embeddedPanelHost = undefined;
  removeEmbeddedPanelKeyHandler?.();
  removeEmbeddedPanelKeyHandler = undefined;
}

function showEmbeddedPanel() {
  if (embeddedPanelHost) return;
  const host = document.createElement('div');
  host.setAttribute('data-upspa-embedded-panel', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'grid',
    placeItems: 'center',
    padding: '16px',
    background: 'rgba(16, 20, 25, .48)',
  });

  const shadow = host.attachShadow({ mode: 'open' });
  const frame = document.createElement('iframe');
  frame.title = 'UpSPA password manager';
  frame.src = chrome.runtime.getURL('embedded-panel.html');
  Object.assign(frame.style, {
    width: 'min(460px, calc(100vw - 32px))',
    height: 'min(640px, calc(100vh - 32px))',
    border: '0',
    borderRadius: '8px',
    background: '#fbfbfb',
    boxShadow: '0 20px 64px rgba(0, 0, 0, .38)',
  });

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close UpSPA');
  closeButton.textContent = 'x';
  Object.assign(closeButton.style, {
    position: 'fixed',
    top: '24px',
    right: '24px',
    width: '32px',
    height: '32px',
    border: '0',
    borderRadius: '50%',
    background: '#ffffff',
    color: '#26323a',
    font: '600 20px Arial, sans-serif',
    lineHeight: '1',
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(0, 0, 0, .2)',
  });
  closeButton.addEventListener('click', closeEmbeddedPanel);
  host.addEventListener('click', (event) => {
    const path = event.composedPath();
    if (!path.includes(frame) && !path.includes(closeButton)) closeEmbeddedPanel();
  });
  shadow.append(frame, closeButton);
  document.documentElement.appendChild(host);
  embeddedPanelHost = host;

  const onKeyDown = (event) => {
    if (event.key === 'Escape') closeEmbeddedPanel();
  };
  document.addEventListener('keydown', onKeyDown, true);
  removeEmbeddedPanelKeyHandler = () => document.removeEventListener('keydown', onKeyDown, true);
}

function ensureLauncher() {
  const attachHost = () => {
    if (!launcherHost) return;
    const mount = document.documentElement || document.body;
    if (mount && launcherHost.parentNode !== mount) mount.appendChild(launcherHost);
  };

  if (launcher && launcherHost) {
    attachHost();
    return launcher;
  }

  document.querySelectorAll('[data-upspa-launcher-host="true"]')
    .forEach((existingHost) => existingHost.remove());
  launcherHost = document.createElement('div');
  launcherHost.setAttribute('data-upspa-launcher-host', 'true');
  const setHostStyle = (name, value) => launcherHost.style.setProperty(name, value, 'important');
  setHostStyle('all', 'initial');
  setHostStyle('position', 'fixed');
  setHostStyle('z-index', '2147483647');
  setHostStyle('display', 'none');
  setHostStyle('width', '32px');
  setHostStyle('height', '32px');
  setHostStyle('margin', '0');
  setHostStyle('padding', '0');
  setHostStyle('border', '0');
  setHostStyle('pointer-events', 'none');
  setHostStyle('contain', 'layout style paint');

  const shadow = launcherHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { color-scheme: light; }
    *, *::before, *::after { box-sizing: border-box; }
    button {
      all: initial;
      box-sizing: border-box;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 1px solid #073f55;
      border-radius: 50%;
      background: #93c5fd;
      color: #073f55;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 16px rgba(1, 60, 76, .24);
      cursor: pointer;
      pointer-events: auto;
      font: 16px/1 Arial, sans-serif;
      -webkit-appearance: none;
      appearance: none;
    }
    button:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
    .key { position: relative; display: block; width: 18px; height: 18px; }
    .ring {
      position: absolute; top: 3px; left: 0; width: 8px; height: 8px;
      border: 2px solid #073f55; border-radius: 50%;
    }
    .shaft {
      position: absolute; top: 8px; left: 9px; width: 8px; height: 3px;
      border-radius: 2px; background: #073f55;
    }
    .tooth {
      position: absolute; top: 8px; left: 14px; width: 3px; height: 7px;
      border-radius: 0 0 2px 2px; background: #073f55;
    }
  `;
  launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open UpSPA extension');
  launcher.setAttribute('title', 'Open UpSPA');
  const keyGlyph = document.createElement('span');
  keyGlyph.className = 'key';
  keyGlyph.setAttribute('aria-hidden', 'true');
  const keyRing = document.createElement('span');
  keyRing.className = 'ring';
  const keyShaft = document.createElement('span');
  keyShaft.className = 'shaft';
  const keyTooth = document.createElement('span');
  keyTooth.className = 'tooth';
  keyGlyph.append(keyRing, keyShaft, keyTooth);
  launcher.appendChild(keyGlyph);
  launcher.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  launcher.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const site = activePrototypeSite();
    if (!site) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPSPA_OPEN_POPUP_REQUESTED',
        url: location.href,
        origin: location.origin,
        siteId: site.id,
      });
      if (!response?.ok) throw new Error(response?.error || 'Chrome did not open UpSPA.');
      launcherTracking = false;
      setLauncherVisible(false);
    } catch {
      launcher.style.borderColor = '#b42318';
      launcher.setAttribute('title', 'Unable to open UpSPA. Use the extension toolbar.');
      window.setTimeout(() => {
        if (!launcher) return;
        launcher.style.borderColor = '#073f55';
        launcher.setAttribute('title', 'Open UpSPA');
      }, 1800);
    }
  });
  shadow.append(style, launcher);
  attachHost();
  return launcher;
}

function setLauncherVisible(visible) {
  if (!launcherHost) return;
  launcherHost.style.setProperty('display', visible ? 'block' : 'none', 'important');
}

function positionLauncher(input) {
  if (!(input instanceof HTMLInputElement) || !input.isConnected) {
    launcherTracking = false;
    launcherTarget = undefined;
    setLauncherVisible(false);
    return;
  }
  const rect = input.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
    setLauncherVisible(false);
    return;
  }
  ensureLauncher();
  const top = Math.min(Math.max(8, window.innerHeight - 40), Math.max(8, rect.top + rect.height / 2 - 16));
  const left = Math.min(window.innerWidth - 40, Math.max(8, rect.right - 36));
  launcherHost.style.setProperty('top', `${top}px`, 'important');
  launcherHost.style.setProperty('left', `${left}px`, 'important');
  setLauncherVisible(true);
}

function hideLauncherLater() {
  window.setTimeout(() => {
    if (!launcher) return;
    const active = deepActiveElement();
    if (active === launcher || active === launcherTarget) return;
    launcherTracking = false;
    launcherTarget = undefined;
    setLauncherVisible(false);
  }, 160);
}

function refreshTrackedLauncher() {
  if (!launcherTracking || !launcherTarget) return;
  if (!launcherTarget.isConnected) {
    launcherTracking = false;
    launcherTarget = undefined;
    setLauncherVisible(false);
    return;
  }
  positionLauncher(launcherTarget);
}

function startPrototypeFieldLauncher() {
  const installKey = Symbol.for('upspa.prototype-field-launcher-installed');
  if (globalThis[installKey]) return;
  globalThis[installKey] = true;

  document.addEventListener(
    'focusin',
    (event) => {
      const site = activePrototypeSite();
      if (!site) return;
      const target = event.composedPath().find((node) => node instanceof HTMLInputElement) || event.target;
      if (!isPrototypeCredentialField(target)) return;
      launcherTarget = target;
      launcherTracking = true;
      positionLauncher(target);
      void publishChromeExtensionEvent(makeExtensionEvent({
        type: 'FIELD_FOCUSED',
        source: 'content',
        url: location.href,
        origin: location.origin,
        siteId: site.id,
        fieldType: classifyFocusedField(target),
      }));
    },
    true,
  );
  document.addEventListener('focusout', hideLauncherLater, true);
  document.addEventListener('scroll', refreshTrackedLauncher, true);
  window.addEventListener('resize', refreshTrackedLauncher);
  window.addEventListener('pageshow', refreshTrackedLauncher);

  const observer = new MutationObserver(refreshTrackedLauncher);
  observer.observe(document, { childList: true, subtree: true });
}

startPrototypeFieldLauncher();

function isVisibleEditableInput(input) {
  if (!(input instanceof HTMLInputElement)) return false;
  if (input.disabled || input.readOnly) return false;
  if (input.type === 'hidden') return false;
  if (input.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  if (/(?:^|[-_])hidden(?:[-_]|$)/i.test(`${input.id} ${input.name}`)) return false;

  const rect = input.getBoundingClientRect();
  const hasBox = rect.width > 0 && rect.height > 0;
  if (!input.offsetParent && !hasBox) return false;

  const style = window.getComputedStyle(input);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

function documentOrder(a, b) {
  if (a === b) return 0;
  const position = a.compareDocumentPosition(b);
  if (!(position & Node.DOCUMENT_POSITION_DISCONNECTED)) {
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }
  const all = querySelectorAllDeep('*');
  return all.indexOf(a) - all.indexOf(b);
}

function uniqueChars(input) {
  const seen = new Set();
  let out = '';
  for (const ch of input || '') {
    if (seen.has(ch)) continue;
    seen.add(ch);
    out += ch;
  }
  return out;
}

function cleanText(text) {
  return String(text || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function visibleText(el) {
  if (!el) return '';
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return '';
  return cleanText(el.textContent || '');
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function addEvidence(evidence, text) {
  const clean = cleanText(text);
  if (!clean) return;
  if (!evidence.includes(clean)) evidence.push(clean.slice(0, 220));
}

function addPolicySource(hints, source) {
  hints.source = Array.isArray(hints.source) ? hints.source : [];
  if (!hints.source.includes(source)) hints.source.push(source);
}

function getVisiblePasswordInputs() {
  return querySelectorAllDeep('input[type="password"]')
    .filter((input) => isVisibleEditableInput(input) && !isNonPasswordChallengeInput(input))
    .sort(documentOrder);
}

function getVisibleTextInputs() {
  return querySelectorAllDeep(TEXT_INPUT_SELECTOR)
    .filter((input) => isVisibleEditableInput(input) && !isSearchLikeInput(input))
    .sort(documentOrder);
}

function unsupportedPrototypeResponse() {
  return { ok: false, error: 'Unsupported site in prototype mode.' };
}

function activePrototypeSite() {
  return getSupportedSiteForUrl(location.href) || getSupportedSiteForUrl(document.referrer);
}

function queryFirst(selectors) {
  for (const selector of selectors || []) {
    try {
      const element = querySelectorDeep(selector);
      if (element instanceof HTMLInputElement && isVisibleEditableInput(element)) return element;
    } catch {
      // Ignore site-specific selector mistakes and fall back to scoring.
    }
  }
  return null;
}

function queryAllVisibleInputs(selectors) {
  const out = [];
  for (const selector of selectors || []) {
    try {
      for (const element of querySelectorAllDeep(selector)) {
        if (element instanceof HTMLInputElement && isVisibleEditableInput(element) && !out.includes(element)) {
          out.push(element);
        }
      }
    } catch {
      // Ignore site-specific selector mistakes and fall back to scoring.
    }
  }
  return out.sort(documentOrder);
}

function chooseHintedAccountInput(selectors, accountId) {
  const candidates = queryAllVisibleInputs(selectors);
  if (candidates.length === 0) return null;
  const wantsEmail = /@/.test(String(accountId || ''));
  if (wantsEmail) {
    return candidates.find((input) => {
      const descriptor = inputDescriptor(input);
      return input.type === 'email' || /\b(?:email|e\s*mail|mobile|phone)\b/.test(descriptor);
    }) || candidates.find((input) => !isSearchLikeInput(input) && !/\buser\s*name|\busername\b/.test(inputDescriptor(input))) || null;
  }
  return candidates.find((input) => /\b(?:user\s*name|username|login\s*id|account\s*id|mobile|phone)\b/.test(inputDescriptor(input)))
    || candidates.find((input) => !isSearchLikeInput(input))
    || candidates[0];
}

const REGISTRATION_USERNAME_RULES = {
  github: {
    separator: '-',
    disallowed: /[^a-zA-Z0-9-]+/g,
    repeated: /-+/g,
    edges: /^-+|-+$/g,
    min: 1,
    max: 39,
  },
  instagram: {
    separator: '_',
    disallowed: /[^a-zA-Z0-9._]+/g,
    repeated: /[._]{2,}/g,
    edges: /^[._]+|[._]+$/g,
    min: 1,
    max: 30,
    lowercase: true,
  },
  gitlab: {
    separator: '-',
    disallowed: /[^a-zA-Z0-9_.-]+/g,
    repeated: /[._-]{2,}/g,
    edges: /^[._-]+|[._-]+$/g,
    min: 2,
    max: 64,
  },
  reddit: {
    separator: '_',
    disallowed: /[^a-zA-Z0-9_-]+/g,
    repeated: /[_-]{2,}/g,
    edges: /^[_-]+|[_-]+$/g,
    min: 3,
    max: 20,
  },
  discord: {
    separator: '.',
    disallowed: /[^a-z0-9._]+/g,
    repeated: /[._]{2,}/g,
    edges: /^[._]+|[._]+$/g,
    min: 2,
    max: 32,
    lowercase: true,
  },
  twitch: {
    separator: '_',
    disallowed: /[^a-zA-Z0-9_]+/g,
    repeated: /_+/g,
    edges: /^_+|_+$/g,
    min: 4,
    max: 25,
    lowercase: true,
  },
  steam: {
    separator: '_',
    disallowed: /[^a-zA-Z0-9_]+/g,
    repeated: /_+/g,
    edges: /^_+|_+$/g,
    min: 3,
    max: 64,
  },
  epicgames: {
    separator: '_',
    disallowed: /[^a-zA-Z0-9_.-]+/g,
    repeated: /[._-]{2,}/g,
    edges: /^[._-]+|[._-]+$/g,
    min: 3,
    max: 16,
  },
  wordpress: {
    separator: '-',
    disallowed: /[^a-z0-9_.-]+/g,
    repeated: /[._-]{2,}/g,
    edges: /^[._-]+|[._-]+$/g,
    min: 1,
    max: 60,
    lowercase: true,
  },
};

function registrationUsernameFromAccountId(site, accountId, input) {
  const clean = String(accountId || '').trim();
  const localPart = clean.includes('@') ? clean.slice(0, clean.indexOf('@')) : clean;
  const rule = REGISTRATION_USERNAME_RULES[site?.id] || {
    separator: '-',
    disallowed: /[^a-zA-Z0-9_.-]+/g,
    repeated: /[._-]{2,}/g,
    edges: /^[._-]+|[._-]+$/g,
    min: 1,
    max: 64,
  };
  let normalized = localPart
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  if (rule.lowercase) normalized = normalized.toLowerCase();
  normalized = normalized
    .replace(rule.disallowed, rule.separator)
    .replace(rule.repeated, rule.separator)
    .replace(rule.edges, '');

  const inputMax = input?.maxLength > 0 ? input.maxLength : Number.POSITIVE_INFINITY;
  const maxLength = Math.min(rule.max, inputMax);
  normalized = normalized.slice(0, maxLength).replace(rule.edges, '');

  const inputMin = input?.minLength > 0 ? input.minLength : 0;
  const minLength = Math.max(rule.min, inputMin);
  if (normalized.length < minLength) {
    const suffix = `${rule.separator}user`;
    normalized = `${normalized || 'upspa'}${suffix}`
      .slice(0, maxLength)
      .replace(rule.edges, '');
  }
  return normalized || 'upspa-user'.slice(0, maxLength);
}

function fillTypedRegistrationIdentity(site, accountId, overwrite = false) {
  const usernameInputs = queryAllVisibleInputs(site?.fieldHints?.registrationUsername);
  const emailInputs = queryAllVisibleInputs(site?.fieldHints?.email);
  if (usernameInputs.length === 0 && emailInputs.length === 0) return null;

  const cleanAccountId = String(accountId || '').trim();
  const email = /^[^@\s]+@[^@\s]+$/.test(cleanAccountId) ? cleanAccountId : '';
  const distinctUsernameInputs = usernameInputs.filter((input) => !emailInputs.includes(input));
  const usernameTargets = distinctUsernameInputs.length > 0
    ? distinctUsernameInputs
    : email ? [] : usernameInputs;
  const username = registrationUsernameFromAccountId(site, cleanAccountId, usernameTargets[0]);
  let filled = false;
  let usernameFilled = false;
  let emailFilled = false;
  for (const input of usernameTargets) {
    const didFill = setInputValue(input, username, { overwrite });
    usernameFilled = didFill || usernameFilled;
    filled = didFill || filled;
  }
  if (email) {
    for (const input of emailInputs) {
      const didFill = setInputValue(input, email, { overwrite });
      emailFilled = didFill || emailFilled;
      filled = didFill || filled;
    }
  }
  if (!filled) return null;

  return {
    username: true,
    captured: mergeCapturedIdentity(
      { accountId: cleanAccountId },
      usernameFilled ? { username } : undefined,
      emailFilled ? { email } : undefined,
    ),
  };
}

function isBefore(a, b) {
  return documentOrder(a, b) < 0;
}

function sameFormOrContainer(input, passwordInput) {
  if (!passwordInput) return true;
  const inputForm = input.form || input.closest('form');
  const passwordForm = passwordInput.form || passwordInput.closest('form');
  if (inputForm && passwordForm) return inputForm === passwordForm;

  const passwordContainer = passwordInput.closest('form, section, article, main, [role="form"], div');
  return passwordContainer ? passwordContainer.contains(input) : true;
}

function getLabels(input) {
  const labels = [];
  const wrappingLabel = visibleText(input.closest('label'));
  if (wrappingLabel) labels.push(wrappingLabel);

  if (input.id) {
    const root = input.getRootNode();
    const queryRoot = root instanceof Document || root instanceof ShadowRoot ? root : document;
    querySelectorAllDeep(`label[for="${cssEscape(input.id)}"]`, queryRoot).forEach((label) => {
      const text = visibleText(label);
      if (text) labels.push(text);
    });
  }

  return labels;
}

function inputDescriptor(input) {
  const parts = [
    input.id,
    input.name,
    input.type,
    input.autocomplete,
    input.placeholder,
    input.title,
    input.getAttribute('aria-label') || '',
    input.getAttribute('role') || '',
    input.getAttribute('data-testid') || '',
    input.getAttribute('data-test') || '',
  ];

  for (const label of getLabels(input)) parts.push(label);

  const form = input.form || input.closest('form');
  if (form) {
    parts.push(
      form.id || '',
      form.getAttribute('name') || '',
      form.getAttribute('aria-label') || '',
      form.getAttribute('role') || '',
    );
  }

  return cleanText(parts.join(' ')).toLowerCase();
}

function isSearchLikeInput(input) {
  if (!(input instanceof HTMLInputElement)) return false;
  if (input.type === 'search' || input.getAttribute('role') === 'searchbox') return true;
  if (input.closest('form[role="search"], [role="search"]')) return true;
  if (/^(?:q|s|query|search|filter)$/i.test(input.name || '') || /^(?:q|s|query|search|filter)$/i.test(input.id || '')) {
    return true;
  }
  return NEGATIVE_FIELD_HINT.test(inputDescriptor(input));
}

function pickBestInput(candidates, score, minScore = 1, exclude) {
  let best = null;
  let bestScore = minScore;
  for (const input of candidates) {
    if (input === exclude) continue;
    const current = score(input);
    if (current > bestScore) {
      best = input;
      bestScore = current;
    }
  }
  return best;
}

function scoreMainUidInput(input) {
  const text = inputDescriptor(input);
  if (NEGATIVE_FIELD_HINT.test(text)) return -100;

  let score = 0;
  if (/\bmain\b/.test(text) && /\b(?:upspa|uid|user)\b/.test(text)) score += 100;
  if (/\bupspa\b/.test(text) && /\b(?:uid|user|id)\b/.test(text)) score += 90;
  if (/\bmaster\b/.test(text) && /\b(?:uid|user|id)\b/.test(text)) score += 70;
  if (/\buid\b/.test(text)) score += 35;
  if (/\b(?:account|email|login|site|server|username|phone|mobile)\b/.test(text)) score -= 70;
  return score;
}

function scoreUsernameInput(input, passwordInput) {
  if (!isVisibleEditableInput(input)) return -100;
  if (isSearchLikeInput(input)) return -100;
  const text = inputDescriptor(input);
  if (NEGATIVE_FIELD_HINT.test(text)) return -100;

  let score = 0;
  const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();

  if (/\busername\b/.test(autocomplete)) score += 160;
  if (/\bemail\b/.test(autocomplete)) score += 130;
  if (input.type === 'email') score += 110;
  if (input.type === 'tel') score += 45;

  if (/\b(?:user\s*name|username|login\s*id|login|email|e\s*mail|account\s*id|account|member\s*id|customer\s*id|client\s*id|site\s*uid|uid|phone|mobile)\b/.test(text)) {
    score += 80;
  }

  if (/\b(?:name|id)\b/.test(text)) score += 10;
  if (/\b(?:password|pass|pwd|pin|new\s*password|confirm|repeat|current\s*password)\b/.test(text)) score -= 140;
  if (/\b(?:main|upspa|master)\b/.test(text) && !/\b(?:account|email|login|username|phone|mobile)\b/.test(text)) {
    score -= 70;
  }

  if (passwordInput) {
    if (sameFormOrContainer(input, passwordInput)) score += 30;
    if (isBefore(input, passwordInput)) score += 25;
    else score -= 20;
  }

  return score;
}

function scoreSiteAccountInput(input, passwordInput, uidInput) {
  if (input === uidInput) return -100;
  const base = scoreUsernameInput(input, passwordInput);
  if (base <= -100) return base;

  const text = inputDescriptor(input);
  let score = base;
  if (/\b(?:account\s*id|account\s*uid|site\s*uid|login\s*id|login\s*uid)\b/.test(text)) score += 80;
  if (/\b(?:email|e\s*mail|username|user\s*name|login|phone|mobile)\b/.test(text)) score += 30;
  if (/\b(?:main|upspa|master)\b/.test(text)) score -= 90;
  return score;
}

function candidateTextInputsFor(passwordInput) {
  const candidates = getVisibleTextInputs().filter((input) => !isSearchLikeInput(input));
  if (!passwordInput) return candidates;

  const scoped = candidates.filter((input) => sameFormOrContainer(input, passwordInput));
  return scoped.length > 0 ? scoped : candidates;
}

function classifyIdentityValue(input, value) {
  const clean = String(value || '').trim();
  if (!clean) return {};
  if (input?.type === 'email' || /@/.test(clean)) return { accountId: clean, email: clean };
  return { accountId: clean, username: clean };
}

function mergeCapturedIdentity(...items) {
  const out = {};
  for (const item of items) {
    if (!item) continue;
    if (item.uid && !out.uid) out.uid = item.uid;
    if (item.accountId && !out.accountId) out.accountId = item.accountId;
    if (item.username && !out.username) out.username = item.username;
    if (item.email && !out.email) out.email = item.email;
  }
  return out;
}

function captureIdentityFields(passwordInput) {
  const candidates = candidateTextInputsFor(passwordInput);
  if (candidates.length === 0) return {};

  const uidInput = pickBestInput(candidates, scoreMainUidInput, 60);
  const accountInput =
    pickBestInput(candidates, (input) => scoreSiteAccountInput(input, passwordInput, uidInput), 35, uidInput || undefined) ||
    (candidates.length === 1 && candidates[0] !== uidInput && scoreUsernameInput(candidates[0], passwordInput) > 30
      ? candidates[0]
      : null) ||
    (passwordInput
      ? candidates.find((input) => input !== uidInput && !isSearchLikeInput(input) && isBefore(input, passwordInput))
      : null) ||
    null;

  return mergeCapturedIdentity(
    uidInput?.value ? { uid: uidInput.value.trim() } : undefined,
    accountInput?.value ? classifyIdentityValue(accountInput, accountInput.value) : undefined,
  );
}

function fillIdentityFields(passwordInput, accountId, uid, overwrite = false, preferredAccountInput = null) {
  const candidates = candidateTextInputsFor(passwordInput);
  if (candidates.length === 0 && !preferredAccountInput) return { username: false, captured: {} };

  const uidInput = uid ? pickBestInput(candidates, scoreMainUidInput, 60) : null;
  const accountInput = preferredAccountInput && preferredAccountInput !== uidInput
    ? preferredAccountInput
    : pickBestInput(candidates, (input) => scoreSiteAccountInput(input, passwordInput, uidInput), 35, uidInput || undefined) ||
    (candidates.length === 1 && candidates[0] !== uidInput && scoreUsernameInput(candidates[0], passwordInput) > 30
      ? candidates[0]
      : null) ||
    (passwordInput
      ? candidates.find((input) => input !== uidInput && !isSearchLikeInput(input) && isBefore(input, passwordInput))
      : null) ||
    null;

  let filled = false;
  if (uidInput && uid) {
    filled = setInputValue(uidInput, uid, { overwrite }) || filled;
  }
  if (accountInput) {
    filled = setInputValue(accountInput, accountId, { overwrite }) || filled;
  }

  const captured = mergeCapturedIdentity(
    uidInput?.value ? { uid: uidInput.value.trim() } : undefined,
    accountInput?.value ? classifyIdentityValue(accountInput, accountInput.value) : classifyIdentityValue(accountInput, accountId),
  );
  return { username: filled, captured };
}

function findUsernameInput(passwordInput) {
  const candidates = candidateTextInputsFor(passwordInput);
  const scored = candidates
    .map((input) => ({ input, score: scoreUsernameInput(input, passwordInput) }))
    .sort((a, b) => (b.score === a.score ? documentOrder(a.input, b.input) : b.score - a.score));

  if (scored[0]?.score > 30) return scored[0].input;
  if (passwordInput) return candidates.find((input) => !isSearchLikeInput(input) && isBefore(input, passwordInput)) || null;
  return null;
}

function passwordDescriptor(input) {
  return inputDescriptor(input);
}

function isNonPasswordChallengeInput(input) {
  if (!(input instanceof HTMLInputElement)) return true;
  const inputMode = (input.getAttribute('inputmode') || '').trim().toLowerCase();
  const pattern = (input.getAttribute('pattern') || '').trim().toLowerCase();
  const descriptor = `${passwordDescriptor(input)} ${input.autocomplete || ''} ${inputMode} ${pattern}`.toLowerCase();
  if (NON_PASSWORD_CHALLENGE_HINT.test(descriptor)) return true;

  // A password-masked numeric control is a PIN/code challenge even when a provider
  // gives it an opaque id/name. Do not put a website password into it.
  if (/^(?:numeric|decimal|tel)$/.test(inputMode)) return true;
  if (pattern && /(?:\\d|\[0-9\])/.test(pattern)) {
    const maxLength = input.maxLength > 0 ? input.maxLength : undefined;
    if (maxLength === undefined || maxLength <= 12) return true;
  }
  return false;
}

function scorePasswordInput(input, mode) {
  if (isNonPasswordChallengeInput(input)) return -1000;
  let score = 0;
  const text = passwordDescriptor(input);
  const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();

  if (NON_PASSWORD_CHALLENGE_HINT.test(text + ' ' + autocomplete)) return -1000;
  if (autocomplete.includes('current-password')) score += mode === 'login' || mode === 'change-old' ? 100 : -80;
  if (autocomplete.includes('new-password')) score += mode === 'register' || mode === 'change-new' ? 120 : -30;
  if (/\b(?:confirm|repeat|retype|again)\b/.test(text)) score += mode === 'register' || mode === 'change-new' ? 55 : -30;
  if (/\b(?:new|create|signup|sign up|register|registration)\b/.test(text)) score += mode === 'register' || mode === 'change-new' ? 45 : -20;
  if (/\b(?:old|current|existing)\b/.test(text)) score += mode === 'change-old' || mode === 'login' ? 35 : -35;
  return score;
}

function passwordInputEligibleForMode(input, mode) {
  if (!(input instanceof HTMLInputElement) || input.type !== 'password') return false;
  if (!isVisibleEditableInput(input) || isNonPasswordChallengeInput(input)) return false;
  const score = scorePasswordInput(input, mode);
  if (mode === 'login') return score >= 0;
  if (mode === 'register') return score > -80;
  return score > -1000;
}

function queryFirstSafePassword(selectors, mode) {
  for (const selector of selectors || []) {
    try {
      const matches = querySelectorAllDeep(selector)
        .filter((input) => passwordInputEligibleForMode(input, mode))
        .sort(documentOrder);
      if (matches[0]) return matches[0];
    } catch {
      // Ignore stale provider selectors and continue with scored discovery.
    }
  }
  return null;
}

function choosePasswordInputs(mode) {
  const inputs = getVisiblePasswordInputs().filter((input) => passwordInputEligibleForMode(input, mode));
  if (inputs.length <= 1) return inputs;

  if (mode === 'login') {
    const best = [...inputs].sort((a, b) => scorePasswordInput(b, mode) - scorePasswordInput(a, mode))[0];
    return best ? [best] : [];
  }

  if (mode === 'register') {
    const scored = inputs
      .map((input, index) => ({ input, index, score: scorePasswordInput(input, mode) }))
      .filter((item) => item.score > -80)
      .sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score));

    if (scored.length >= 2 && scored[0].score > 0) {
      return scored.slice(0, 2).map((item) => item.input).sort(documentOrder);
    }
    return inputs.slice(0, 2);
  }

  return inputs;
}

function setInputValue(input, value, options = {}) {
  const overwrite = Boolean(options.overwrite);
  if (!overwrite && String(input.value || '').trim()) return String(input.value) === String(value);
  try {
    if (input.type !== 'hidden') input.focus({ preventScroll: true });
  } catch {
    // Some sites deliberately block focus; the value setter and events below still work.
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;

  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
  return true;
}

function waitFor(predicate, timeoutMs = 1500) {
  const immediate = predicate();
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let done = false;
    let stopObserving = () => {};
    let timer;
    const finish = (value) => {
      if (done) return;
      done = true;
      stopObserving();
      window.clearTimeout(timer);
      resolve(value);
    };

    stopObserving = observeDeepMutations(() => {
      const value = predicate();
      if (value) finish(value);
    }, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['type', 'style', 'class', 'hidden', 'disabled', 'readonly', 'aria-hidden'],
      shadowRootPollMs: 100,
    });

    timer = window.setTimeout(() => finish(predicate()), timeoutMs);
  });
}

const registrationMetadataByForm = new WeakMap();
const registrationSubmitRoots = new WeakSet();

function submittedForm(event) {
  if (event.target instanceof HTMLFormElement) return event.target;
  return event.composedPath().find((node) => node instanceof HTMLFormElement) || null;
}

function handleRegistrationSubmit(event) {
  const form = submittedForm(event);
  if (!form) return;
  const metadata = registrationMetadataByForm.get(form);
  if (!metadata?.flowId) return;
  chrome.runtime.sendMessage({
    type: 'UPSPA_REGISTRATION_FORM_SUBMITTED',
    flowId: metadata.flowId,
    origin: location.origin,
  });
}

function ensureRegistrationSubmitListener(root) {
  if (registrationSubmitRoots.has(root)) return;
  root.addEventListener('submit', handleRegistrationSubmit, true);
  registrationSubmitRoots.add(root);
}

function attachRegistrationMetadata(passwordInput, metadata) {
  const form = passwordInput?.form || passwordInput?.closest('form');
  if (!form || !metadata?.flowId) return;
  registrationMetadataByForm.set(form, {
    flowId: metadata.flowId,
    origin: metadata.origin,
    confirmationNonce: metadata.confirmationNonce,
  });
  const root = form.getRootNode();
  if (root instanceof Document || root instanceof ShadowRoot) ensureRegistrationSubmitListener(root);
}

ensureRegistrationSubmitListener(document);

async function fillRegister(accountId, passwordForLs, uid, metadata = {}, overwrite = false) {
  const site = activePrototypeSite();
  if (!site) return unsupportedPrototypeResponse();

  const formTarget = await waitFor(() => {
    const hinted = hintedPasswordInputs(site, 'register');
    const passwordInputs = [...hinted, ...choosePasswordInputs('register')]
      .filter((input, index, all) => all.indexOf(input) === index)
      .sort(documentOrder);
    const username = queryFirst(site.fieldHints?.registrationUsername)
      || queryFirst(site.fieldHints?.email)
      || queryFirst(site.fieldHints?.username)
      || findUsernameInput(passwordInputs[0]);
    return passwordInputs.length > 0 || username ? { passwordInputs, username } : null;
  });
  if (!formTarget) {
    return { ok: false, error: 'No visible account identifier or password field found for registration.' };
  }

  const passwordInputs = formTarget.passwordInputs;
  if (passwordInputs[0]) attachRegistrationMetadata(passwordInputs[0], metadata);

  const typedIdentity = fillTypedRegistrationIdentity(site, accountId, overwrite);
  const preferredUsername = chooseHintedAccountInput(
    site.fieldHints?.registrationUsername || site.fieldHints?.username,
    accountId,
  );
  const identity = typedIdentity || fillIdentityFields(
    passwordInputs[0],
    accountId,
    uid,
    overwrite,
    preferredUsername || formTarget.username,
  );
  const usernameFilled = identity.username;
  let passwordsFilled = 0;
  for (const input of passwordInputs.slice(0, 2)) {
    if (setInputValue(input, passwordForLs, { overwrite })) passwordsFilled += 1;
  }

  return {
    ok: true,
    filled: { username: usernameFilled, passwords: passwordsFilled },
    captured: identity.captured,
  };
}

async function fillIdentity(accountId, uid, overwrite = false) {
  const site = activePrototypeSite();
  if (!site) return unsupportedPrototypeResponse();

  const target = await waitFor(() => {
    const passwordInput = choosePasswordInputs('register')[0];
    const hintedUsername = queryFirst(site.fieldHints?.registrationUsername)
      || queryFirst(site.fieldHints?.email)
      || queryFirst(site.fieldHints?.username);
    const username = hintedUsername || findUsernameInput(passwordInput);
    return username || passwordInput ? { username, passwordInput } : null;
  });
  if (!target) {
    return { ok: false, error: 'No visible username, email, phone, or account-ID field found for registration.' };
  }

  const typedIdentity = fillTypedRegistrationIdentity(site, accountId, overwrite);
  const preferredUsername = chooseHintedAccountInput(
    site.fieldHints?.registrationUsername || site.fieldHints?.username,
    accountId,
  );
  const identity = typedIdentity || fillIdentityFields(
    target.passwordInput,
    accountId,
    uid,
    overwrite,
    preferredUsername || (target.username && !isSearchLikeInput(target.username) ? target.username : null),
  );
  const usernameFilled = identity.username;
  if (!usernameFilled) {
    return { ok: false, error: 'The visible account identifier field could not be filled.' };
  }
  return { ok: true, filled: { username: true, passwords: 0 }, captured: identity.captured };
}

async function fillLogin(accountId, passwordForLs, uid, overwrite = false) {
  const site = activePrototypeSite();
  if (!site) return unsupportedPrototypeResponse();

  const formTarget = await waitFor(() => {
    const hintedPasswords = hintedPasswordInputs(site, 'login');
    const passwords = hintedPasswords.length > 0 ? hintedPasswords.slice(0, 1) : choosePasswordInputs('login');
    const username = queryFirst(site.fieldHints?.username) || findUsernameInput(passwords[0]);
    return passwords.length > 0 || username ? { passwords, username } : null;
  });

  if (!formTarget) {
    return { ok: false, error: 'No visible username, email, phone, or password field found for login.' };
  }

  const passwordInput = formTarget.passwords[0];
  let usernameFilled = false;

  if (passwordInput) {
    const identity = fillIdentityFields(passwordInput, accountId, uid, overwrite);
    usernameFilled = identity.username;

    if (!usernameFilled) {
      const usernameInput = formTarget.username || findUsernameInput(passwordInput);
      if (usernameInput) {
        usernameFilled = setInputValue(usernameInput, accountId, { overwrite });
      }
    }

    const passwordFilled = setInputValue(passwordInput, passwordForLs, { overwrite }) ? 1 : 0;
    return {
      ok: true,
      filled: { username: usernameFilled, passwords: passwordFilled },
      captured: identity.captured,
    };
  }

  if (formTarget.username) {
    const usernameFilled = setInputValue(formTarget.username, accountId, { overwrite });
    return {
      ok: true,
      filled: { username: usernameFilled, passwords: 0 },
      captured: mergeCapturedIdentity(
        formTarget.username.value ? classifyIdentityValue(formTarget.username, formTarget.username.value) : undefined,
      ),
    };
  }

  return { ok: false, error: 'No visible username, email, or phone field found for login.' };
}


function queryPasswordUpdateField(kind, exclude) {
  const hints = kind === 'old'
    ? ['old_password', 'current_password', 'existing_password', 'old-password', 'current-password', 'password_old', 'password_current']
    : ['new_password', 'password_confirm', 'confirm_password', 'password_new', 'new-password', 'password-confirm', 'confirm-password'];

  const candidates = querySelectorAllDeep('input')
    .filter((input) => input instanceof HTMLInputElement
      && input !== exclude
      && passwordInputEligibleForMode(input, kind === 'old' ? 'change-old' : 'change-new'))
    .map((input) => {
      const descriptor = cleanText([
        input.id,
        input.name,
        input.autocomplete,
        input.placeholder,
        input.title,
        input.getAttribute('aria-label') || '',
      ].join(' ')).toLowerCase();
      let score = 0;
      for (const hint of hints) {
        if (descriptor.includes(hint.replace(/_/g, ' ')) || descriptor.includes(hint)) score += 100;
      }
      if (input.type === 'hidden') score += 30;
      if (input.type === 'password') score += 20;
      return { input, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.input || null;
}

async function fillPasswordChange(
  oldPasswordForLs,
  newPasswordForLs,
  overwrite = false,
  continuationExpectedStage = 'password-change',
) {
  const site = activePrototypeSite();
  if (!site) return unsupportedPrototypeResponse();

  const target = await waitFor(() => {
    const namedOldInput = queryFirstSafePassword(site.fieldHints?.oldPassword, 'change-old')
      || queryPasswordUpdateField('old');
    const namedNewInput = queryFirstSafePassword(site.fieldHints?.newPassword, 'change-new')
      || queryPasswordUpdateField('new', namedOldInput || undefined);
    const discoveredInputs = [namedOldInput, namedNewInput, ...getVisiblePasswordInputs()]
      .filter((input, index, all) => input && all.indexOf(input) === index && isVisibleEditableInput(input));
    const passwordInputs = continuationExpectedStage === 'new-password'
      ? discoveredInputs.filter((input) => input === namedNewInput || scorePasswordInput(input, 'change-new') > 0)
      : discoveredInputs;
    return passwordInputs.length > 0 ? { namedOldInput, namedNewInput, passwordInputs } : null;
  });
  if (!target) {
    return {
      ok: false,
      error: 'No visible password field found for the current password-change stage.',
    };
  }

  const { namedOldInput, namedNewInput, passwordInputs } = target;
  const descriptors = passwordInputs.map((input) => inputDescriptor(input));
  let passwordsFilled = 0;
  let newPasswordsFilled = 0;

  passwordInputs.forEach((input, index) => {
    const descriptor = descriptors[index];
    const explicitOld = input === namedOldInput || /\b(?:old|current|existing)\b/.test(descriptor) || input.autocomplete === 'current-password';
    const explicitNew = input === namedNewInput || /\b(?:new|confirm|repeat|retype|again)\b/.test(descriptor) || input.autocomplete === 'new-password';
    let value = oldPasswordForLs;
    if (continuationExpectedStage === 'new-password' || explicitNew) value = newPasswordForLs;
    else if (explicitOld) value = oldPasswordForLs;
    else if (passwordInputs.length >= 3) value = index === 0 ? oldPasswordForLs : newPasswordForLs;
    else if (passwordInputs.length >= 2) value = index === 0 ? oldPasswordForLs : newPasswordForLs;
    if (setInputValue(input, value, { overwrite })) {
      passwordsFilled += 1;
      if (value === newPasswordForLs) newPasswordsFilled += 1;
    }
  });

  if (passwordsFilled === 0) {
    return { ok: false, error: 'The visible password-change fields could not be filled.' };
  }

  return {
    ok: true,
    filled: { username: false, passwords: passwordsFilled },
    passwordStage: newPasswordsFilled > 0 ? 'new-password' : 'password-change',
  };
}

function parseInteger(value) {
  const match = String(value || '').match(/\d{1,3}/);
  return match ? Number(match[0]) : undefined;
}

function getFirstAttribute(input, names) {
  for (const name of names) {
    const value = input.getAttribute(name);
    if (value !== null && value !== '') return { name, value };
  }
  return null;
}

function parseSymbolClass(raw) {
  const custom = raw.match(/\[([^\]]+)\]/);
  if (custom) return uniqueChars(custom[1].replace(/\\/g, ''));
  if (/special|symbol|ascii-printable|unicode/i.test(raw)) return DEFAULT_SYMBOLS;
  return '';
}

function parsePasswordRules(rules, hints, evidence) {
  if (!rules) return;
  addPolicySource(hints, 'passwordrules');
  addEvidence(evidence, `passwordrules present: ${rules}`);

  const statements = String(rules)
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

  for (const statement of statements) {
    const [rawKey, ...rawValueParts] = statement.split(':');
    const key = cleanText(rawKey).toLowerCase();
    const value = rawValueParts.join(':').trim();
    const lowerValue = value.toLowerCase();

    if (key === 'minlength') {
      const parsed = parseInteger(value);
      if (parsed !== undefined) hints.minLength = parsed;
    }
    if (key === 'maxlength') {
      const parsed = parseInteger(value);
      if (parsed !== undefined) hints.maxLength = parsed;
    }
    if (key === 'required') {
      if (/lower/.test(lowerValue)) hints.requireLowercase = true;
      if (/upper/.test(lowerValue)) hints.requireUppercase = true;
      if (/digit|number/.test(lowerValue)) hints.requireDigit = true;
      const customSymbols = parseSymbolClass(value);
      if (/special|symbol|ascii-printable|unicode|\[[^\]]+\]/i.test(value)) {
        hints.requireSpecial = true;
        hints.allowedSpecials = uniqueChars((hints.allowedSpecials || '') + customSymbols) || DEFAULT_SYMBOLS;
      }
    }
    if (key === 'allowed') {
      const customSymbols = parseSymbolClass(value);
      if (customSymbols) hints.allowedSpecials = uniqueChars((hints.allowedSpecials || '') + customSymbols);
    }
  }
}

function getAssociatedText(input, evidence) {
  const parts = [];

  for (const label of getLabels(input)) {
    parts.push(label);
    addEvidence(evidence, `label text: ${label}`);
  }

  const describedBy = `${input.getAttribute('aria-describedby') || ''} ${input.getAttribute('aria-errormessage') || ''}`;
  describedBy
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((idRef) => {
      const text = visibleText(document.getElementById(idRef));
      if (text) {
        parts.push(text);
        addEvidence(evidence, `aria text: ${text}`);
      }
    });

  for (const attr of ['title', 'placeholder', 'autocomplete', 'pattern', 'data-val-length', 'data-rule-password']) {
    const value = input.getAttribute(attr);
    if (value) {
      parts.push(value);
      addEvidence(evidence, `password input ${attr}=${value}`);
    }
  }

  const form = input.form || input.closest('form');
  const formText = visibleText(form);
  if (formText) {
    parts.push(formText);
    addEvidence(evidence, `form text: ${formText}`);
  }

  const container = input.closest('section, article, main, [role="form"], fieldset, div');
  const containerText = visibleText(container);
  if (containerText && containerText !== formText) {
    parts.push(containerText);
    addEvidence(evidence, `nearby text: ${containerText}`);
  }

  let sibling = input.parentElement;
  for (let depth = 0; sibling && depth < 3; depth += 1, sibling = sibling.parentElement) {
    const text = visibleText(sibling);
    if (text) parts.push(text);
  }

  return parts.join(' ');
}

function inferPolicyFromText(text, hints, evidence) {
  if (cleanText(text)) {
    addPolicySource(hints, 'visible-text');
    hints.rawText = cleanText(text).slice(0, 1000);
  }
  const lower = text.toLowerCase();

  const betweenMatch =
    lower.match(/between\s+(\d{1,3})\s+(?:and|to)\s+(\d{1,3})\s+(?:characters?|chars?)?/) ||
    lower.match(/(\d{1,3})\s*(?:-|to)\s*(\d{1,3})\s+(?:characters?|chars?)/);
  if (betweenMatch) {
    hints.minLength = Number(betweenMatch[1]);
    hints.maxLength = Number(betweenMatch[2]);
    addEvidence(evidence, `detected length range ${betweenMatch[1]}-${betweenMatch[2]}`);
  }

  const minMatch =
    lower.match(/(?:at least|minimum|min(?:imum)? length(?: of)?|must be at least)\s*(\d{1,3})/) ||
    lower.match(/(\d{1,3})\s+(?:or more|characters?|chars?)\s+(?:minimum|min|or more)/) ||
    lower.match(/length\s+must\s+be\s+(?:>=|at least)\s*(\d{1,3})/);
  if (minMatch) {
    hints.minLength = Number(minMatch[1]);
    addEvidence(evidence, `detected minimum length ${minMatch[1]}`);
  }

  const maxMatch =
    lower.match(/(?:maximum|max(?:imum)? length(?: of)?|up to|no more than|must be no more than)\s*(\d{1,3})/) ||
    lower.match(/(\d{1,3})\s+(?:characters?|chars?)\s+(?:maximum|max|or fewer)/) ||
    lower.match(/length\s+must\s+be\s+(?:<=|at most)\s*(\d{1,3})/);
  if (maxMatch) {
    hints.maxLength = Number(maxMatch[1]);
    addEvidence(evidence, `detected maximum length ${maxMatch[1]}`);
  }

  if (/\b(?:uppercase|upper-case|capital letter|upper case)\b/i.test(text)) {
    hints.requireUppercase = true;
    addEvidence(evidence, 'detected uppercase requirement');
  }
  if (/\b(?:lowercase|lower-case|lower case)\b/i.test(text)) {
    hints.requireLowercase = true;
    addEvidence(evidence, 'detected lowercase requirement');
  }
  if (/\b(?:number|digit|numeric|0-9)\b/i.test(text)) {
    hints.requireDigit = true;
    addEvidence(evidence, 'detected digit requirement');
  }
  if (/\b(?:special character|special chars?|symbols?|punctuation|non[- ]?alphanumeric)\b/i.test(text)) {
    hints.requireSpecial = true;
    addEvidence(evidence, 'detected symbol requirement');
  }

  const symbolListMatch = text.match(/(?:special characters?|symbols?|allowed characters?).{0,40}?([!@#$%^&*()_+\-=\[\]{}|;:'",.<>/?`~\\]{2,})/i);
  if (symbolListMatch) {
    hints.requireSpecial = true;
    hints.allowedSpecials = uniqueChars(symbolListMatch[1]);
    addEvidence(evidence, `detected allowed symbols ${hints.allowedSpecials}`);
  } else if (hints.requireSpecial && !hints.allowedSpecials) {
    hints.allowedSpecials = DEFAULT_SYMBOLS;
  }

  if (/\b(?:no spaces|without spaces|must not contain spaces|cannot contain spaces|no whitespace|without whitespace)\b/i.test(text)) {
    hints.disallowedChars = uniqueChars(`${hints.disallowedChars || ''} \t\r\n`);
    addEvidence(evidence, 'detected no-whitespace requirement');
  }
  if (/\b(?:must not contain|cannot contain|should not contain).{0,20}\b(?:username|user name|email|e-mail)\b/i.test(text)) {
    hints.forbiddenSubstrings = ['username', 'email'];
    addEvidence(evidence, 'detected no username/email requirement');
  }
}

function inferPolicyFromPattern(pattern, hints, evidence) {
  addPolicySource(hints, 'html-attributes');
  hints.pattern = pattern;
  addEvidence(evidence, `pattern attribute present: ${pattern}`);

  const lengthLookahead = pattern.match(/\.\{(\d{1,3})(?:,(\d{0,3}))?\}/) || pattern.match(/\[\^?\]\{(\d{1,3})(?:,(\d{0,3}))?\}/);
  if (lengthLookahead) {
    hints.minLength = Number(lengthLookahead[1]);
    if (lengthLookahead[2]) hints.maxLength = Number(lengthLookahead[2]);
  }

  if (/(?:A-Z|upper)/i.test(pattern)) hints.requireUppercase = true;
  if (/(?:a-z|lower)/i.test(pattern)) hints.requireLowercase = true;
  if (/(?:\\d|0-9|digit)/i.test(pattern)) hints.requireDigit = true;

  const symbolClass = pattern.match(/\[([^\]]*[!@#$%^&*()_+\-=\[\]{}|;:'",.<>/?`~\\][^\]]*)\]/);
  if (symbolClass) {
    const onlySymbols = uniqueChars(symbolClass[1].replace(/\\/g, '').replace(/[A-Za-z0-9\-]/g, ''));
    hints.requireSpecial = true;
    if (onlySymbols) hints.allowedSpecials = onlySymbols;
  }
}

async function extractPasswordPolicy() {
  const input = await waitFor(() => getVisiblePasswordInputs()[0] || null);
  if (!input) {
    return { ok: false, error: 'No visible password field found for policy detection.' };
  }

  const hints = { source: [] };
  const evidence = [];

  const minAttr = getFirstAttribute(input, MIN_ATTR_CANDIDATES);
  const maxAttr = getFirstAttribute(input, MAX_ATTR_CANDIDATES);
  const pattern = input.getAttribute('pattern');
  const rulesAttr = getFirstAttribute(input, POLICY_ATTR_CANDIDATES);

  if (minAttr) {
    const parsed = parseInteger(minAttr.value);
    if (parsed !== undefined) {
      hints.minLength = parsed;
      addPolicySource(hints, 'html-attributes');
      addEvidence(evidence, `password input ${minAttr.name}=${minAttr.value}`);
    }
  }
  if (maxAttr) {
    const parsed = parseInteger(maxAttr.value);
    if (parsed !== undefined) {
      hints.maxLength = parsed;
      addPolicySource(hints, 'html-attributes');
      addEvidence(evidence, `password input ${maxAttr.name}=${maxAttr.value}`);
    }
  }
  if (pattern) inferPolicyFromPattern(pattern, hints, evidence);
  if (rulesAttr) parsePasswordRules(rulesAttr.value, hints, evidence);
  if (input.required) addEvidence(evidence, 'password input required=true');

  const text = getAssociatedText(input, evidence);
  inferPolicyFromText(text, hints, evidence);

  if (evidence.length === 0) {
    addEvidence(evidence, 'No explicit password policy was found on the page; using safe defaults.');
  }

  return { ok: true, policyHints: hints, evidence };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'UPSPA_SHOW_EMBEDDED_PANEL') {
      showEmbeddedPanel();
      return { ok: true, filled: { username: false, passwords: 0 } };
    }
    if (message.type === 'UPSPA_EXTRACT_PASSWORD_POLICY') {
      return extractPasswordPolicy();
    }
    if (message.type === 'UPSPA_CAPTURE_IDENTITY_FIELDS') {
      const passwords = choosePasswordInputs('register');
      return { ok: true, captured: captureIdentityFields(passwords[0]) };
    }
    if (message.type === 'UPSPA_FILL_IDENTITY') {
      if (message.payload.siteId && activePrototypeSite()?.id !== message.payload.siteId) {
        return { ok: false, error: 'Credential fill was scoped to a different supported site.' };
      }
      return fillIdentity(
        message.payload.accountId,
        message.payload.uid,
        message.payload.overwrite ?? true,
      );
    }
    if (message.type === 'UPSPA_FILL_REGISTER') {
      if (message.payload.siteId && activePrototypeSite()?.id !== message.payload.siteId) {
        return { ok: false, error: 'Credential fill was scoped to a different supported site.' };
      }
      const continuation = rememberCredentialContinuation({
        kind: 'registration',
        accountId: message.payload.accountId,
        uid: message.payload.uid,
        passwordForLs: message.payload.passwordForLs,
        flowId: message.payload.flowId,
        origin: message.payload.origin,
        confirmationNonce: message.payload.confirmationNonce,
      });
      const result = await fillRegister(
        message.payload.accountId,
        message.payload.passwordForLs,
        message.payload.uid,
        {
          flowId: message.payload.flowId,
          origin: message.payload.origin,
          confirmationNonce: message.payload.confirmationNonce,
        },
        message.payload.overwrite ?? true,
      );
      await settleCredentialContinuation(continuation, result);
      return result;
    }
    if (message.type === 'UPSPA_FILL_LOGIN') {
      if (message.payload.siteId && activePrototypeSite()?.id !== message.payload.siteId) {
        return { ok: false, error: 'Credential fill was scoped to a different supported site.' };
      }
      const continuation = rememberCredentialContinuation({
        kind: 'authentication',
        accountId: message.payload.accountId,
        uid: message.payload.uid,
        passwordForLs: message.payload.passwordForLs,
      });
      const result = await fillLogin(
        message.payload.accountId,
        message.payload.passwordForLs,
        message.payload.uid,
        message.payload.overwrite ?? true,
      );
      await settleCredentialContinuation(continuation, result);
      return result;
    }
    if (message.type === 'UPSPA_FILL_PASSWORD_CHANGE') {
      if (message.payload.siteId && activePrototypeSite()?.id !== message.payload.siteId) {
        return { ok: false, error: 'Credential fill was scoped to a different supported site.' };
      }
      const continuation = rememberCredentialContinuation({
        kind: 'website-password-update',
        oldPasswordForLs: message.payload.oldPasswordForLs,
        newPasswordForLs: message.payload.newPasswordForLs,
      });
      const result = await fillPasswordChange(
        message.payload.oldPasswordForLs,
        message.payload.newPasswordForLs,
        message.payload.overwrite ?? true,
      );
      await settleCredentialContinuation(continuation, result);
      return result;
    }
    if (message.type === 'UPSPA_CLEAR_IN_PAGE_CONTINUATION') {
      activeCredentialContinuation = undefined;
      lastContinuationSignature = '';
      return { ok: true, filled: { username: false, passwords: 0 } };
    }
    return { ok: false, error: `Unknown content-script message: ${message.type}` };
  })()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});
