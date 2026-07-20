import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeExtensionEvent } from './events/extensionEvents';
import { getDetectedPageContext, saveDetectedPageContext } from './pageContext';

type Store = Record<string, unknown>;
let store: Store;

function installChromeStorage(): void {
  store = {};
  const area = {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Store) => Object.assign(store, items)),
    remove: vi.fn(async (key: string) => { delete store[key]; }),
  };
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { storage: { session: area, local: area } },
  });
}

const emptyFields = {
  username: false,
  password: false,
  passwordCount: 0,
  currentPassword: false,
  newPassword: false,
  submit: false,
};

describe('detected page context', () => {
  beforeEach(installChromeStorage);

  it('prefers a live credential frame and ignores a removed frame', async () => {
    await saveDetectedPageContext(
      makeExtensionEvent({
        type: 'FORM_DETECTED',
        source: 'content',
        url: 'https://www.reddit.com/',
        origin: 'https://www.reddit.com',
        siteId: 'reddit',
        formType: 'unknown',
        fields: emptyFields,
      }),
      { tab: { id: 7 }, frameId: 0 } as chrome.runtime.MessageSender,
    );
    await saveDetectedPageContext(
      makeExtensionEvent({
        type: 'FORM_DETECTED',
        source: 'content',
        url: 'https://www.reddit.com/',
        origin: 'https://www.reddit.com',
        siteId: 'reddit',
        formType: 'register',
        fields: { ...emptyFields, username: true },
      }),
      { tab: { id: 7 }, frameId: 3 } as chrome.runtime.MessageSender,
    );

    await expect(getDetectedPageContext(7, 'reddit', [0, 3])).resolves.toMatchObject({ frameId: 3, formType: 'register' });
    await expect(getDetectedPageContext(7, 'reddit', [0])).resolves.toMatchObject({ frameId: 0, formType: 'unknown' });
  });

  it('prefers visible credential evidence over a newer route-only top frame', async () => {
    await saveDetectedPageContext(
      makeExtensionEvent({
        type: 'FORM_DETECTED',
        source: 'content',
        url: 'https://github.com/signup',
        origin: 'https://github.com',
        siteId: 'github',
        formType: 'unknown',
        fields: { ...emptyFields, username: true },
      }),
      { tab: { id: 11 }, frameId: 8, url: 'about:blank' } as chrome.runtime.MessageSender,
    );
    await saveDetectedPageContext(
      makeExtensionEvent({
        type: 'FORM_DETECTED',
        source: 'content',
        url: 'https://github.com/signup',
        origin: 'https://github.com',
        siteId: 'github',
        formType: 'register',
        fields: emptyFields,
      }),
      { tab: { id: 11 }, frameId: 0, url: 'https://github.com/signup' } as chrome.runtime.MessageSender,
    );

    await expect(getDetectedPageContext(11, 'github', [0, 8])).resolves.toMatchObject({
      frameId: 8,
      formType: 'unknown',
      fields: { username: true },
    });
  });
});
