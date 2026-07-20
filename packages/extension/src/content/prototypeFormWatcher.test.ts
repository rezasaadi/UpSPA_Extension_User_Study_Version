// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPrototypeFormWatcher } from './prototypeFormWatcher';
import type { ExtensionEvent } from '../shared/events/extensionEvents';

function setLocation(url: string): void {
  const locationLike = new URL(url) as unknown as Location;
  Object.defineProperty(window, 'location', { configurable: true, value: locationLike });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: locationLike });
}

function makeVisibleElements(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 120,
    height: 24,
    top: 0,
    left: 0,
    right: 120,
    bottom: 24,
    toJSON: () => undefined,
  } as DOMRect);
}

async function flushWatcher(): Promise<void> {
  await vi.advanceTimersByTimeAsync(5);
  await Promise.resolve();
}

describe('prototype form watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    makeVisibleElements();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('emits supported site, policy, and form events for a supported login page', async () => {
    setLocation('https://github.com/login');
    document.body.innerHTML = '<input type="text" autocomplete="username"><input type="password"><button type="submit">Sign in</button>';
    const events: ExtensionEvent[] = [];
    const stop = startPrototypeFormWatcher({ emit: (event) => events.push(event), debounceMs: 1 });

    await flushWatcher();
    stop();

    expect(events.map((event) => event.type)).toContain('SUPPORTED_SITE_DETECTED');
    expect(events.find((event) => event.type === 'PAGE_CLASSIFIED')).toMatchObject({
      type: 'PAGE_CLASSIFIED',
      siteId: 'github',
      pageKind: 'login',
    });
    expect(events.map((event) => event.type)).toContain('POLICY_LOADED');
    expect(events.find((event) => event.type === 'FORM_DETECTED')).toMatchObject({
      type: 'FORM_DETECTED',
      siteId: 'github',
      formType: 'login',
    });
  });

  it('emits unsupported site events for unknown hosts', async () => {
    setLocation('https://unknown.example/login');
    document.body.innerHTML = '<input type="password">';
    const events: ExtensionEvent[] = [];
    const stop = startPrototypeFormWatcher({ emit: (event) => events.push(event), debounceMs: 1 });

    await flushWatcher();
    stop();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'UNSUPPORTED_SITE_DETECTED', host: 'unknown.example' });
  });

  it('emits form detection when password inputs are added dynamically', async () => {
    setLocation('https://github.com/signup');
    document.body.innerHTML = '<input type="email" autocomplete="email">';
    const events: ExtensionEvent[] = [];
    const stop = startPrototypeFormWatcher({ emit: (event) => events.push(event), debounceMs: 1 });

    await flushWatcher();
    events.length = 0;
    document.body.insertAdjacentHTML('beforeend', '<input type="password" autocomplete="new-password">');
    await flushWatcher();
    stop();

    expect(events.find((event) => event.type === 'FORM_DETECTED')).toMatchObject({
      type: 'FORM_DETECTED',
      siteId: 'github',
    });
  });

  it('classifies an identifier-only Reddit modal from its dialog heading', async () => {
    setLocation('https://www.reddit.com/');
    document.body.innerHTML = '<div role="dialog"><h2>Sign Up</h2><input type="email" aria-label="Email"><button>Continue</button><a>Log In</a></div>';
    const events: ExtensionEvent[] = [];
    const stop = startPrototypeFormWatcher({ emit: (event) => events.push(event), debounceMs: 1 });

    await flushWatcher();
    stop();

    expect(events.find((event) => event.type === 'PAGE_CLASSIFIED')).toMatchObject({
      type: 'PAGE_CLASSIFIED',
      siteId: 'reddit',
      pageKind: 'dashboard',
    });
    expect(events.find((event) => event.type === 'FORM_DETECTED')).toMatchObject({
      type: 'FORM_DETECTED',
      siteId: 'reddit',
      formType: 'register',
      fields: { username: true, password: false },
    });
  });

  it('detects and observes credential fields in nested open shadow roots', async () => {
    setLocation('https://github.com/login');
    const outerHost = document.createElement('div');
    const outerRoot = outerHost.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('section');
    const innerRoot = innerHost.attachShadow({ mode: 'open' });
    innerRoot.innerHTML = '<form><h2>Sign in</h2><input name="login" autocomplete="username"><button type="submit">Continue</button></form>';
    outerRoot.appendChild(innerHost);
    document.body.appendChild(outerHost);

    const events: ExtensionEvent[] = [];
    const stop = startPrototypeFormWatcher({ emit: (event) => events.push(event), debounceMs: 1 });
    await flushWatcher();

    expect(events.find((event) => event.type === 'FORM_DETECTED')).toMatchObject({
      type: 'FORM_DETECTED',
      siteId: 'github',
      formType: 'login',
      fields: { username: true, password: false, submit: true },
    });

    events.length = 0;
    innerRoot.querySelector('form')?.insertAdjacentHTML(
      'beforeend',
      '<input type="password" autocomplete="current-password">',
    );
    await flushWatcher();
    stop();

    expect(events.find((event) => event.type === 'FORM_DETECTED')).toMatchObject({
      type: 'FORM_DETECTED',
      fields: { username: true, password: true, passwordCount: 1, currentPassword: true },
    });
  });

  it('does not classify generic search boxes as usernames', async () => {
    setLocation('https://www.reddit.com/');
    document.body.innerHTML = '<form role="search"><input type="text" name="q" aria-label="Search Reddit"><button type="submit">Search</button></form>';
    const events: ExtensionEvent[] = [];
    const stop = startPrototypeFormWatcher({ emit: (event) => events.push(event), debounceMs: 1 });

    await flushWatcher();
    stop();

    expect(events.find((event) => event.type === 'FORM_DETECTED')).toMatchObject({
      type: 'FORM_DETECTED',
      formType: 'unknown',
      fields: { username: false, password: false },
    });
  });

  it('periodically re-emits an unchanged form snapshot before context expires', async () => {
    setLocation('https://github.com/login');
    document.body.innerHTML = '<input autocomplete="username"><input type="password">';
    const events: ExtensionEvent[] = [];
    const stop = startPrototypeFormWatcher({
      emit: (event) => events.push(event),
      debounceMs: 1,
      heartbeatMs: 20,
      urlPollMs: 1000,
    });

    await flushWatcher();
    events.length = 0;
    await vi.advanceTimersByTimeAsync(25);
    await Promise.resolve();
    stop();

    expect(events.find((event) => event.type === 'FORM_DETECTED')).toMatchObject({
      type: 'FORM_DETECTED',
      siteId: 'github',
      formType: 'login',
    });
  });

  it('refreshes classification after shadow text and SPA URL changes', async () => {
    setLocation('https://www.reddit.com/');
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<div role="dialog"><h2>Log In</h2><input type="email" aria-label="Email"></div>';
    document.body.appendChild(host);
    const events: ExtensionEvent[] = [];
    const stop = startPrototypeFormWatcher({
      emit: (event) => events.push(event),
      debounceMs: 1,
      heartbeatMs: 10_000,
      urlPollMs: 5,
    });

    await flushWatcher();
    expect(events.find((event) => event.type === 'FORM_DETECTED')).toMatchObject({ formType: 'login' });

    events.length = 0;
    const headingText = root.querySelector('h2')?.firstChild;
    if (headingText) headingText.textContent = 'Sign Up';
    await Promise.resolve();
    await flushWatcher();
    expect(events.find((event) => event.type === 'FORM_DETECTED')).toMatchObject({ formType: 'register' });

    events.length = 0;
    window.location.hash = '#register-step-two';
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    stop();

    expect(events.find((event) => event.type === 'FORM_DETECTED')).toMatchObject({
      type: 'FORM_DETECTED',
      siteId: 'reddit',
    });
  });

  it('lets strong form evidence override a misleading static route', async () => {
    setLocation('https://github.com/login');
    document.body.innerHTML = [
      '<form aria-label="Create account">',
      '<h1>Create account</h1>',
      '<input type="email" autocomplete="username">',
      '<input type="password" autocomplete="new-password">',
      '<button type="submit">Register</button>',
      '</form>',
    ].join('');
    const events: ExtensionEvent[] = [];
    const stop = startPrototypeFormWatcher({ emit: (event) => events.push(event), debounceMs: 1 });

    await flushWatcher();
    stop();

    expect(events.find((event) => event.type === 'PAGE_CLASSIFIED')).toMatchObject({ pageKind: 'login' });
    expect(events.find((event) => event.type === 'FORM_DETECTED')).toMatchObject({ formType: 'register' });
  });

  it('ignores nearby account-switch links when inferring form intent', async () => {
    setLocation('https://github.com/login');
    document.body.innerHTML = [
      '<form>',
      '<input type="email" autocomplete="username">',
      '<input type="password" autocomplete="current-password">',
      '<button type="submit">Continue</button>',
      '<a href="/signup">Create account</a>',
      '</form>',
    ].join('');
    const events: ExtensionEvent[] = [];
    const stop = startPrototypeFormWatcher({ emit: (event) => events.push(event), debounceMs: 1 });

    await flushWatcher();
    stop();

    expect(events.find((event) => event.type === 'FORM_DETECTED')).toMatchObject({ formType: 'login' });
  });
});
