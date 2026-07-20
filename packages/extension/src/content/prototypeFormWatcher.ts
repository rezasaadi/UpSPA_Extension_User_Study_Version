import { getSupportedSiteForUrl } from '../shared/supportedSites';
import { classifyPage } from '../shared/pageClassifier';
import { makeExtensionEvent, type ExtensionEvent, type FieldDetectionSummary, type PrototypeFormType } from '../shared/events/extensionEvents';
import {
  observeDeepMutations,
  querySelectorAllDeep,
  querySelectorDeep,
  type DeepQueryRoot,
} from '../shared/deepDom';

export type PrototypeFormWatcherOptions = {
  emit: (event: ExtensionEvent) => void | Promise<void>;
  debounceMs?: number;
  heartbeatMs?: number;
  urlPollMs?: number;
};

const IDENTITY_INPUT_SELECTOR = [
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  'input[type="email"]',
  'input[type="tel"]',
  'input[name*="email" i]',
  'input[id*="email" i]',
  'input[name*="user" i]',
  'input[id*="user" i]',
  'input:not([type])',
  'input[type="text"]',
].join(',');

const SUBMIT_SELECTOR = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button[name*="login" i]',
  'button[id*="login" i]',
  'button[name*="sign" i]',
  'button[id*="sign" i]',
  'button[name*="register" i]',
  'button[id*="register" i]',
].join(',');

function visible(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  if (htmlElement.hidden || htmlElement.getAttribute('aria-hidden') === 'true') return false;
  if (htmlElement instanceof HTMLInputElement && (htmlElement.disabled || htmlElement.readOnly)) return false;
  const rect = htmlElement.getBoundingClientRect();
  const style = getComputedStyle(htmlElement);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function queryVisible(selector: string, root: DeepQueryRoot = document): Element[] {
  return querySelectorAllDeep(selector, root).filter(visible);
}

function identityDescriptor(input: HTMLInputElement): string {
  const labels = Array.from(input.labels ?? []).map((label) => label.textContent ?? '');
  const wrappingLabel = input.closest('label')?.textContent ?? '';
  const form = input.form ?? input.closest('form');
  return [
    input.type,
    input.id,
    input.name,
    input.autocomplete,
    input.placeholder,
    input.title,
    input.getAttribute('aria-label') ?? '',
    input.getAttribute('role') ?? '',
    input.getAttribute('data-testid') ?? '',
    input.getAttribute('data-test') ?? '',
    form?.getAttribute('role') ?? '',
    form?.getAttribute('aria-label') ?? '',
    wrappingLabel,
    ...labels,
  ].join(' ').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function likelyIdentityInput(element: Element): element is HTMLInputElement {
  if (!(element instanceof HTMLInputElement) || !visible(element) || element.disabled || element.readOnly) return false;

  const descriptor = identityDescriptor(element);
  if (element.type === 'search' || element.getAttribute('role') === 'searchbox') return false;
  if (element.closest('form[role="search"], [role="search"]')) return false;
  if (/\b(?:search|query|filter|coupon|promo|postal|zip|captcha|verification|one time|otp|token)\b/.test(descriptor)) {
    return false;
  }

  const autocomplete = element.autocomplete.toLowerCase();
  if (/\b(?:username|email)\b/.test(autocomplete)) return true;
  if (element.type === 'email') return true;

  return /\b(?:user\s*name|username|email|e\s*mail|login\s*(?:id|name)?|account\s*(?:id|name)?|member\s*id|customer\s*id|phone|mobile)\b/.test(descriptor);
}

function detectFields(): FieldDetectionSummary {
  const passwordInputs = queryVisible('input[type="password"]');
  const newPasswordInputs = queryVisible([
    'input[autocomplete="new-password"]',
    'input[name*="new" i][type="password"]',
    'input[id*="new" i][type="password"]',
  ].join(','));
  const currentPasswordInputs = queryVisible([
    'input[autocomplete="current-password"]',
    'input[name*="current" i][type="password"]',
    'input[id*="current" i][type="password"]',
    'input[name*="old" i][type="password"]',
    'input[id*="old" i][type="password"]',
  ].join(','));

  return {
    username: queryVisible(IDENTITY_INPUT_SELECTOR).some(likelyIdentityInput),
    password: passwordInputs.length > 0,
    passwordCount: passwordInputs.length,
    currentPassword: currentPasswordInputs.length > 0,
    newPassword: newPasswordInputs.length > 0,
    submit: queryVisible(SUBMIT_SELECTOR).length > 0,
  };
}

function credentialContextText(): { heading: string; intent: string } {
  const input = queryVisible(`${IDENTITY_INPUT_SELECTOR}, input[type="password"]`)
    .find((element) => element.matches('input[type="password"]') || likelyIdentityInput(element));
  const root = input?.closest('dialog, [role="dialog"], form, [role="form"], section, article, main')
    ?? (input?.getRootNode() as DeepQueryRoot | undefined)
    ?? document.body;
  const headingElement = querySelectorDeep('h1, h2, h3, [role="heading"], [aria-level]', root);
  const submitElement = queryVisible('button[type="submit"], input[type="submit"]', root)[0];
  const rootElement = root instanceof Element ? root : undefined;
  return {
    heading: (headingElement?.textContent ?? '').trim().toLowerCase(),
    intent: [
      rootElement?.id ?? '',
      rootElement?.getAttribute('name') ?? '',
      rootElement?.getAttribute('aria-label') ?? '',
      submitElement?.textContent ?? '',
      submitElement instanceof HTMLInputElement ? submitElement.value : '',
    ].join(' ').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(),
  };
}

function inferFormType(fields: FieldDetectionSummary, pageKind: ReturnType<typeof classifyPage>['kind']): PrototypeFormType {
  if (fields.currentPassword && fields.newPassword && fields.passwordCount >= 2) return 'password-update';
  if (fields.username || fields.password) {
    const context = credentialContextText();
    const registrationIntent = /\b(?:sign up|signup|create account|register|registration|join)\b/;
    const loginIntent = /\b(?:log in|login|sign in|signin|welcome back)\b/;
    if (registrationIntent.test(context.heading) || registrationIntent.test(context.intent)) return 'register';
    if (loginIntent.test(context.heading) || loginIntent.test(context.intent)) return 'login';
    if (fields.newPassword && !fields.currentPassword) return 'register';
  }
  if (pageKind === 'password-change') return 'password-update';
  if (pageKind === 'sign-up') return 'register';
  if (pageKind === 'login') return 'login';
  if (fields.username && fields.passwordCount >= 1) return 'login';
  return 'unknown';
}

function snapshotSignature(siteId: string | undefined, fields: FieldDetectionSummary, formType: PrototypeFormType): string {
  return JSON.stringify({ siteId, fields, formType, pathname: location.pathname, hash: location.hash });
}

export function startPrototypeFormWatcher(options: PrototypeFormWatcherOptions): () => void {
  const debounceMs = options.debounceMs ?? 250;
  const heartbeatMs = options.heartbeatMs ?? 60_000;
  const urlPollMs = options.urlPollMs ?? 500;
  let timer: number | undefined;
  let lastSignature = '';
  let lastSnapshotAt = 0;
  let lastUrl = location.href;

  const emitSnapshot = async (): Promise<void> => {
    const sourceUrl = getSupportedSiteForUrl(location.href) ? location.href : document.referrer || location.href;
    const site = getSupportedSiteForUrl(sourceUrl);
    let parsedSource: URL | undefined;
    try {
      parsedSource = new URL(sourceUrl);
    } catch {
      parsedSource = undefined;
    }
    const origin = parsedSource?.origin ?? location.origin;
    const host = parsedSource?.hostname ?? location.hostname;

    if (!site) {
      const signature = `unsupported:${host}:${location.pathname}`;
      if (signature === lastSignature && Date.now() - lastSnapshotAt < heartbeatMs) return;
      lastSignature = signature;
      lastSnapshotAt = Date.now();
      await options.emit(makeExtensionEvent({
        type: 'UNSUPPORTED_SITE_DETECTED',
        source: 'content',
        url: location.href,
        origin,
        host,
        reason: 'Not in the 40-site prototype registry.',
      }));
      return;
    }

    const classification = classifyPage(sourceUrl);
    await options.emit(makeExtensionEvent({
      type: 'PAGE_CLASSIFIED',
      source: 'content',
      url: sourceUrl,
      origin,
      siteId: site.id,
      pageKind: classification.kind,
    }));

    const fields = detectFields();
    const formType = inferFormType(fields, classification.kind);
    const signature = snapshotSignature(site.id, fields, formType);
    if (signature === lastSignature && Date.now() - lastSnapshotAt < heartbeatMs) return;
    lastSignature = signature;
    lastSnapshotAt = Date.now();

    await options.emit(makeExtensionEvent({
      type: 'SUPPORTED_SITE_DETECTED',
      source: 'content',
      url: sourceUrl,
      origin,
      host,
      siteId: site.id,
      label: site.label,
    }));

    await options.emit(makeExtensionEvent({
      type: 'POLICY_LOADED',
      source: 'content',
      siteId: site.id,
      label: site.label,
      policy: site.policy,
      policyNote: site.policyNote,
    }));

    await options.emit(makeExtensionEvent({
      type: 'FORM_DETECTED',
      source: 'content',
      url: sourceUrl,
      origin,
      siteId: site.id,
      formType,
      fields,
    }));
  };

  const schedule = (): void => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void emitSnapshot();
    }, debounceMs);
  };

  const stopObserving = observeDeepMutations(schedule, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
    attributeFilter: [
      'type',
      'name',
      'id',
      'class',
      'style',
      'hidden',
      'disabled',
      'readonly',
      'autocomplete',
      'aria-label',
      'aria-hidden',
      'placeholder',
    ],
    shadowRootPollMs: Math.max(100, debounceMs),
  });

  const heartbeatTimer = window.setInterval(schedule, heartbeatMs);
  const urlTimer = window.setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    schedule();
  }, urlPollMs);
  const onNavigation = (): void => {
    lastUrl = location.href;
    schedule();
  };
  window.addEventListener('popstate', onNavigation);
  window.addEventListener('hashchange', onNavigation);

  schedule();

  return () => {
    if (timer !== undefined) window.clearTimeout(timer);
    window.clearInterval(heartbeatTimer);
    window.clearInterval(urlTimer);
    window.removeEventListener('popstate', onNavigation);
    window.removeEventListener('hashchange', onNavigation);
    stopObserving();
  };
}
