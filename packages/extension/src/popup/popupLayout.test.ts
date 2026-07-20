import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('./popup.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('./popup.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('./popup.ts', import.meta.url), 'utf8');

describe('popup and side-panel layout', () => {
  it('keeps primary workflow actions visibly labelled', () => {
    for (const id of ['pickerContinue', 'detailsContinue', 'settingsSubmit', 'confirmOperation', 'successDone']) {
      expect(html).toMatch(new RegExp(`<button id="${id}" class="primary-button[^>]*>[^<]+</button>`));
    }
  });

  it('fits narrow side panels and allows vertical scrolling', () => {
    expect(css).toContain('max-width: 100vw');
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('@media (max-width: 340px)');
    expect(css).not.toContain('width: max-content');
  });

  it('always requires the master password for website authentication', () => {
    expect(source).toContain("masterAuthPasswordFieldEl.classList.remove('hidden')");
    expect(source).toContain('const masterPassword = masterAuthPasswordEl.value;');
    expect(source).not.toContain('const masterPassword = masterAuthPasswordEl.value || transientMasterPassword;');
  });

  it('refreshes Cj locally without changing or filling a website password', () => {
    const start = source.indexOf('async function prepareWebsitePasswordUpdate');
    const end = source.indexOf('async function resumePendingFill', start);
    const updateFlow = source.slice(start, end);
    expect(html).toContain('Current website password');
    expect(html).toContain('Refresh Saved Website Record');
    expect(updateFlow).toContain('currentWebsitePassword !== oldEncoded.password');
    expect(updateFlow).toContain('prepared.newForLs !== prepared.oldForLs');
    expect(updateFlow).toContain('commitSecretUpdateForSite');
    expect(updateFlow).toContain('USER_CONFIRMED_WEBSITE_RECORD_REFRESHED');
    expect(updateFlow).not.toContain('UPSPA_FILL_PASSWORD_CHANGE');
    expect(updateFlow).not.toContain('saveCredentialContinuation');
    expect(updateFlow).not.toContain('newEncoded');
    expect(updateFlow).not.toContain('showWaiting');
  });
});
