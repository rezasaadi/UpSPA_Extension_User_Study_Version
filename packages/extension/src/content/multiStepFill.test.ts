// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

let runtimeListener: RuntimeListener | undefined;

function setLocation(url: string): void {
  const locationLike = new URL(url) as unknown as Location;
  Object.defineProperty(window, 'location', { configurable: true, value: locationLike });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: locationLike });
}

function installVisibleElements(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 180,
    height: 32,
    top: 0,
    left: 0,
    right: 180,
    bottom: 32,
    toJSON: () => undefined,
  } as DOMRect);
}

function installChrome(): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        lastError: undefined,
        getURL: vi.fn((path: string) => `chrome-extension://upspa/${path}`),
        onMessage: {
          addListener: vi.fn((listener: RuntimeListener) => { runtimeListener = listener; }),
        },
        sendMessage: vi.fn(async (message: { type?: string }) => {
          if (message.type === 'UPSPA_GET_CREDENTIAL_CONTINUATION') return { ok: true };
          return { ok: true };
        }),
      },
    },
  });
}

async function dispatch(message: unknown): Promise<any> {
  if (!runtimeListener) throw new Error('Content runtime listener was not installed.');
  return new Promise((resolve) => {
    runtimeListener!(message, {}, resolve);
  });
}

async function advanceContinuation(): Promise<void> {
  await vi.advanceTimersByTimeAsync(700);
  await Promise.resolve();
}

describe('multi-step content filling', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    runtimeListener = undefined;
    setLocation('https://github.com/login');
    installVisibleElements();
    installChrome();
    document.body.innerHTML = '';
    await import('./index');
    await advanceContinuation();
  });

  afterEach(async () => {
    document.body.innerHTML = '';
    await Promise.resolve();
    await Promise.resolve();
    document.querySelectorAll('[data-upspa-launcher-host="true"], [data-upspa-embedded-panel="true"]')
      .forEach((element) => element.remove());
    await Promise.resolve();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('continues login, sign-up, and password-update values when the next stage appears', async () => {
    document.body.innerHTML = '<input id="login" type="email" autocomplete="username">';
    const loginFirst = await dispatch({
      type: 'UPSPA_FILL_LOGIN',
      payload: { accountId: 'alice@example.com', passwordForLs: 'login-secret', overwrite: true },
    });
    expect(loginFirst).toMatchObject({ ok: true, filled: { username: true, passwords: 0 } });
    expect((document.getElementById('login') as HTMLInputElement).value).toBe('alice@example.com');

    document.body.innerHTML = '<input id="password" type="password" autocomplete="current-password">';
    await advanceContinuation();
    expect((document.getElementById('password') as HTMLInputElement).value).toBe('login-secret');

    setLocation('https://github.com/signup');
    document.body.innerHTML = '<input id="signup-email" type="email" autocomplete="email">';
    const signupFirst = await dispatch({
      type: 'UPSPA_FILL_REGISTER',
      payload: { accountId: 'new@example.com', passwordForLs: 'signup-secret', flowId: 'reg-1', origin: 'https://github.com', overwrite: true },
    });
    expect(signupFirst).toMatchObject({ ok: true, filled: { username: true, passwords: 0 } });

    document.body.innerHTML = '<form><input id="new" type="password" autocomplete="new-password"><input id="confirm" type="password" autocomplete="new-password"></form>';
    await advanceContinuation();
    expect((document.getElementById('new') as HTMLInputElement).value).toBe('signup-secret');
    expect((document.getElementById('confirm') as HTMLInputElement).value).toBe('signup-secret');

    setLocation('https://github.com/settings/security');
    document.body.innerHTML = '<input id="current" type="password" autocomplete="current-password">';
    const updateFirst = await dispatch({
      type: 'UPSPA_FILL_PASSWORD_CHANGE',
      payload: { oldPasswordForLs: 'old-secret', newPasswordForLs: 'new-secret', overwrite: true },
    });
    expect(updateFirst).toMatchObject({ ok: true, filled: { passwords: 1 } });
    expect((document.getElementById('current') as HTMLInputElement).value).toBe('old-secret');

    document.body.innerHTML = '<input id="next-password" type="password" autocomplete="new-password"><input id="confirm-password" type="password" autocomplete="new-password">';
    await advanceContinuation();
    expect((document.getElementById('next-password') as HTMLInputElement).value).toBe('new-secret');
    expect((document.getElementById('confirm-password') as HTMLInputElement).value).toBe('new-secret');

    document.body.innerHTML = '<input id="scoped" type="password">';
    const wrongSite = await dispatch({
      type: 'UPSPA_FILL_LOGIN',
      payload: { siteId: 'google', accountId: 'wrong@example.com', passwordForLs: 'must-not-fill', overwrite: true },
    });
    expect(wrongSite).toMatchObject({ ok: false });
    expect((document.getElementById('scoped') as HTMLInputElement).value).toBe('');
  });

  it('rejects OTP and security-answer fields, scopes continuation to auth pages, and consumes it after password fill', async () => {
    setLocation('https://github.com/login');
    document.body.innerHTML = [
      '<input id="account" name="login" autocomplete="username">',
      '<input id="otp" name="verification_code" type="password" autocomplete="one-time-code" aria-label="Verification code">',
    ].join('');

    const firstStage = await dispatch({
      type: 'UPSPA_FILL_LOGIN',
      payload: { accountId: 'safe@example.com', passwordForLs: 'login-secret', overwrite: true },
    });
    expect(firstStage).toMatchObject({ ok: true, filled: { username: true, passwords: 0 } });
    expect((document.getElementById('otp') as HTMLInputElement).value).toBe('');

    document.body.innerHTML = '<input id="opaque-pin" type="password" inputmode="numeric" maxlength="6">';
    await advanceContinuation();
    expect((document.getElementById('opaque-pin') as HTMLInputElement).value).toBe('');

    setLocation('https://github.com/');
    document.body.innerHTML = '<form><h1>Create account</h1><input id="wrong-operation" type="password" autocomplete="current-password"><button type="submit">Sign up</button></form>';
    await advanceContinuation();
    expect((document.getElementById('wrong-operation') as HTMLInputElement).value).toBe('');

    setLocation('https://github.com/settings/profile');
    document.body.innerHTML = '<input id="unrelated" type="password" aria-label="Private profile value">';
    await advanceContinuation();
    expect((document.getElementById('unrelated') as HTMLInputElement).value).toBe('');

    setLocation('https://github.com/login');
    document.body.innerHTML = '<input id="security-answer" type="password" aria-label="Security question answer">';
    await advanceContinuation();
    expect((document.getElementById('security-answer') as HTMLInputElement).value).toBe('');

    document.body.innerHTML = '<input id="real-password" type="password" autocomplete="current-password">';
    await advanceContinuation();
    expect((document.getElementById('real-password') as HTMLInputElement).value).toBe('login-secret');

    document.body.innerHTML = '<input id="must-stay-empty" type="password" autocomplete="current-password">';
    await advanceContinuation();
    expect((document.getElementById('must-stay-empty') as HTMLInputElement).value).toBe('');
    expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.map(([message]) => message)).toContainEqual({
      type: 'UPSPA_CLEAR_CREDENTIAL_CONTINUATION',
      siteId: 'github',
      flowId: undefined,
    });
  });

  it('fills the registration identity before any password is supplied', async () => {
    document.body.innerHTML = '<input id="signup-email" type="email" autocomplete="email"><input id="signup-password" type="password" autocomplete="new-password">';

    const identity = await dispatch({
      type: 'UPSPA_FILL_IDENTITY',
      payload: { accountId: 'new@example.com', overwrite: true },
    });

    expect(identity).toMatchObject({ ok: true, filled: { username: true, passwords: 0 } });
    expect((document.getElementById('signup-email') as HTMLInputElement).value).toBe('new@example.com');
    expect((document.getElementById('signup-password') as HTMLInputElement).value).toBe('');
  });

  it('does not fill staged password artifacts marked hidden by the provider', async () => {
    document.body.innerHTML = [
      '<input id="account" type="email" autocomplete="username">',
      '<input id="hidden-password" name="password" type="password" autocomplete="current-password">',
    ].join('');

    const result = await dispatch({
      type: 'UPSPA_FILL_LOGIN',
      payload: { accountId: 'staged@example.com', passwordForLs: 'must-wait', overwrite: true },
    });

    expect(result).toMatchObject({ ok: true, filled: { username: true, passwords: 0 } });
    expect((document.getElementById('account') as HTMLInputElement).value).toBe('staged@example.com');
    expect((document.getElementById('hidden-password') as HTMLInputElement).value).toBe('');
  });

  it('fills separate Instagram email and username fields without touching full name', async () => {
    setLocation('https://www.instagram.com/accounts/emailsignup/');
    document.body.innerHTML = [
      '<label>Mobile number or email<input id="instagram-email" name="emailOrPhone" type="text" autocomplete="off"></label>',
      '<label>Password<input id="instagram-password" type="password" autocomplete="off"></label>',
      '<label>Full name<input id="instagram-name" type="text" autocomplete="off"></label>',
      '<label>Username<input id="instagram-username" type="search" placeholder="Username" aria-label="Username"></label>',
    ].join('');

    const emailResult = await dispatch({
      type: 'UPSPA_FILL_IDENTITY',
      payload: { accountId: 'study@example.com', overwrite: true },
    });
    expect(emailResult).toMatchObject({ ok: true, filled: { username: true, passwords: 0 } });
    expect((document.getElementById('instagram-email') as HTMLInputElement).value).toBe('study@example.com');
    expect((document.getElementById('instagram-username') as HTMLInputElement).value).toBe('study');
    expect((document.getElementById('instagram-name') as HTMLInputElement).value).toBe('');

    (document.getElementById('instagram-email') as HTMLInputElement).value = '';
    (document.getElementById('instagram-username') as HTMLInputElement).value = '';
    const usernameResult = await dispatch({
      type: 'UPSPA_FILL_IDENTITY',
      payload: { accountId: 'study_handle', overwrite: true },
    });
    expect(usernameResult).toMatchObject({ ok: true, filled: { username: true, passwords: 0 } });
    expect((document.getElementById('instagram-email') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('instagram-username') as HTMLInputElement).value).toBe('study_handle');
    expect((document.getElementById('instagram-name') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('instagram-password') as HTMLInputElement).value).toBe('');
  });

  it('fills typed Discord and Steam registration identities without display-name or search spillover', async () => {
    setLocation('https://discord.com/register');
    document.body.innerHTML = [
      '<input id="discord-email" name="email" type="email">',
      '<input id="discord-display-name" name="global_name" type="text" aria-label="Display Name">',
      '<input id="discord-username" name="username" type="text" autocomplete="username">',
      '<input id="discord-password" name="password" type="password" autocomplete="new-password">',
    ].join('');

    const discord = await dispatch({
      type: 'UPSPA_FILL_IDENTITY',
      payload: { accountId: 'Alice+Study@example.com', overwrite: true },
    });
    expect(discord).toMatchObject({ ok: true, filled: { username: true, passwords: 0 } });
    expect((document.getElementById('discord-email') as HTMLInputElement).value).toBe('Alice+Study@example.com');
    expect((document.getElementById('discord-username') as HTMLInputElement).value).toBe('alice.study');
    expect((document.getElementById('discord-display-name') as HTMLInputElement).value).toBe('');

    setLocation('https://store.steampowered.com/join/');
    document.body.innerHTML = [
      '<input id="store-search" name="term" type="search" aria-label="Search">',
      '<input id="email" name="email" type="email">',
      '<input id="reenter_email" name="reenter_email" type="email">',
      '<input id="accountname" name="accountname" type="text">',
    ].join('');

    const steam = await dispatch({
      type: 'UPSPA_FILL_IDENTITY',
      payload: { accountId: 'steam.study@example.com', overwrite: true },
    });
    expect(steam).toMatchObject({ ok: true, filled: { username: true, passwords: 0 } });
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('steam.study@example.com');
    expect((document.getElementById('reenter_email') as HTMLInputElement).value).toBe('steam.study@example.com');
    expect((document.getElementById('accountname') as HTMLInputElement).value).toBe('steam_study');
    expect((document.getElementById('store-search') as HTMLInputElement).value).toBe('');
  });

  it('autofills registration in nested open shadow roots without injecting upspa fields', async () => {
    document.body.innerHTML = '<form role="search"><input id="site-search" type="text" name="q" aria-label="Search"></form>';
    const outerHost = document.createElement('div');
    const outerRoot = outerHost.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('section');
    const innerRoot = innerHost.attachShadow({ mode: 'open' });
    innerRoot.innerHTML = [
      '<form id="signup">',
      '<input name="user[login]" type="text" autocomplete="username">',
      '<input name="user[email]" type="email" autocomplete="email">',
      '<input name="user[password]" type="password" autocomplete="new-password">',
      '<input name="confirm_password" type="password" autocomplete="new-password">',
      '<button type="submit">Create account</button>',
      '</form>',
    ].join('');
    outerRoot.appendChild(innerHost);
    document.body.appendChild(outerHost);

    const result = await dispatch({
      type: 'UPSPA_FILL_REGISTER',
      payload: {
        accountId: 'shadow@example.com',
        passwordForLs: 'shadow-secret',
        flowId: 'shadow-flow',
        origin: 'https://metadata.example',
        confirmationNonce: 'nonce-1',
        overwrite: true,
      },
    });

    const form = innerRoot.getElementById('signup') as HTMLFormElement;
    expect(result).toMatchObject({ ok: true, filled: { username: true, passwords: 2 } });
    expect((form.elements.namedItem('user[login]') as HTMLInputElement).value).toBe('shadow');
    expect((form.elements.namedItem('user[email]') as HTMLInputElement).value).toBe('shadow@example.com');
    expect((form.elements.namedItem('user[password]') as HTMLInputElement).value).toBe('shadow-secret');
    expect((form.elements.namedItem('confirm_password') as HTMLInputElement).value).toBe('shadow-secret');
    expect((document.getElementById('site-search') as HTMLInputElement).value).toBe('');
    expect(form.querySelectorAll('input[name^="upspa_"]')).toHaveLength(0);

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.map(([message]) => message)).toContainEqual({
      type: 'UPSPA_REGISTRATION_FORM_SUBMITTED',
      flowId: 'shadow-flow',
      origin: 'https://github.com',
    });
  });

  it('keeps GitHub registration username and email distinct while preserving email login', async () => {
    setLocation('https://github.com/signup');
    document.body.innerHTML = [
      '<form>',
      '<input id="github-username" name="user[login]" type="text" autocomplete="username">',
      '<input id="github-email" name="user[email]" type="email" autocomplete="email">',
      '<input id="github-new-password" name="user[password]" type="password" autocomplete="new-password">',
      '</form>',
    ].join('');

    const registration = await dispatch({
      type: 'UPSPA_FILL_REGISTER',
      payload: {
        accountId: 'alice.dev+study@example.com',
        passwordForLs: 'github-registration-secret',
        overwrite: true,
      },
    });

    expect(registration).toMatchObject({ ok: true, filled: { username: true, passwords: 1 } });
    expect((document.getElementById('github-username') as HTMLInputElement).value).toBe('alice-dev-study');
    expect((document.getElementById('github-username') as HTMLInputElement).value).not.toContain('@');
    expect((document.getElementById('github-email') as HTMLInputElement).value).toBe('alice.dev+study@example.com');
    expect((document.getElementById('github-new-password') as HTMLInputElement).value).toBe('github-registration-secret');

    setLocation('https://github.com/login');
    document.body.innerHTML = [
      '<form>',
      '<input id="github-login" name="login" type="text" autocomplete="username">',
      '<input id="github-password" name="password" type="password" autocomplete="current-password">',
      '</form>',
    ].join('');

    const login = await dispatch({
      type: 'UPSPA_FILL_LOGIN',
      payload: {
        accountId: 'alice.dev+study@example.com',
        passwordForLs: 'github-login-secret',
        overwrite: true,
      },
    });

    expect(login).toMatchObject({ ok: true, filled: { username: true, passwords: 1 } });
    expect((document.getElementById('github-login') as HTMLInputElement).value).toBe('alice.dev+study@example.com');
    expect((document.getElementById('github-password') as HTMLInputElement).value).toBe('github-login-secret');
  });

  it('renders the field launcher in isolated shadow DOM and can display the embedded panel fallback', async () => {
    document.body.innerHTML = [
      '<style>button { display: none !important; width: 1px !important; }</style>',
      '<input id="email" type="email" autocomplete="username">',
    ].join('');
    const input = document.getElementById('email') as HTMLInputElement;
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    const host = document.querySelector('[data-upspa-launcher-host="true"]') as HTMLDivElement;
    const launcher = host.shadowRoot?.querySelector('[aria-label="Open UpSPA extension"]') as HTMLButtonElement;
    const isolatedStyles = host.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(document.querySelector('[aria-label="Open UpSPA extension"]')).toBeNull();
    expect(host).toBeTruthy();
    expect(launcher).toBeTruthy();
    expect(launcher.textContent).toBe('');
    expect(host.style.getPropertyValue('width')).toBe('32px');
    expect(host.style.getPropertyValue('height')).toBe('32px');
    expect(host.style.getPropertyValue('display')).toBe('block');
    expect(host.style.getPropertyPriority('display')).toBe('important');
    expect(isolatedStyles).toContain('all: initial');
    expect(isolatedStyles).toContain('display: flex');

    const opened = await dispatch({ type: 'UPSPA_SHOW_EMBEDDED_PANEL' });
    expect(opened).toMatchObject({ ok: true });
    const panel = document.querySelector('[data-upspa-embedded-panel="true"]') as HTMLDivElement;
    expect(panel).toBeTruthy();
    const frame = panel.shadowRoot?.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe('chrome-extension://upspa/embedded-panel.html');
  });

  it('repositions and reattaches the launcher after scroll, resize, and SPA DOM replacement', async () => {
    document.body.innerHTML = '<input id="first-email" type="email" autocomplete="username">';
    const firstInput = document.getElementById('first-email') as HTMLInputElement;
    firstInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    const host = document.querySelector('[data-upspa-launcher-host="true"]') as HTMLDivElement;
    expect(host.style.top).toBe('8px');
    expect(host.style.left).toBe('144px');

    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      x: 120,
      y: 100,
      width: 180,
      height: 32,
      top: 100,
      left: 120,
      right: 300,
      bottom: 132,
      toJSON: () => undefined,
    } as DOMRect);
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(host.style.top).toBe('100px');
    expect(host.style.left).toBe('264px');

    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      x: 140,
      y: 120,
      width: 180,
      height: 32,
      top: 120,
      left: 140,
      right: 320,
      bottom: 152,
      toJSON: () => undefined,
    } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect(host.style.top).toBe('120px');
    expect(host.style.left).toBe('284px');

    host.remove();
    await Promise.resolve();
    await Promise.resolve();
    expect(host.isConnected).toBe(true);

    document.body.innerHTML = '<input id="replacement-email" type="email" autocomplete="username">';
    await Promise.resolve();
    const replacementInput = document.getElementById('replacement-email') as HTMLInputElement;
    replacementInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(host.isConnected).toBe(true);
    expect(document.querySelectorAll('[data-upspa-launcher-host="true"]')).toHaveLength(1);
    expect(host.style.display).toBe('block');
  });
});
