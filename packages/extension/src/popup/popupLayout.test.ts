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

  it('rebuilds Cj locally from the entered current website password', () => {
    const start = source.indexOf('async function prepareWebsitePasswordUpdate');
    const end = source.indexOf('async function resumePendingFill', start);
    const updateFlow = source.slice(start, end);
    expect(html).toContain('Current website password');
    expect(html).toContain('Update Saved Per-Site Secret');
    expect(updateFlow).toContain('prepareSecretUpdateForSite(');
    expect(updateFlow).toContain('currentWebsitePassword,');
    expect(updateFlow).toContain('commitSecretUpdateForSite');
    expect(updateFlow).toContain("credentialMode: 'embedded-password'");
    expect(updateFlow).toContain('USER_CONFIRMED_WEBSITE_RECORD_REFRESHED');
    expect(updateFlow).not.toContain('UPSPA_FILL_PASSWORD_CHANGE');
    expect(updateFlow).not.toContain('saveCredentialContinuation');
    expect(updateFlow).not.toContain('encodeForAccount');
    expect(updateFlow).not.toContain('showWaiting');
  });

  it('imports an existing website password entirely inside the extension', () => {
    const start = source.indexOf('async function importExistingAccount');
    const end = source.indexOf('async function confirmRegistration', start);
    const importFlow = source.slice(start, end);
    expect(importFlow).toContain('prepareMigrationForSite(');
    expect(importFlow).toContain('websitePassword,');
    expect(importFlow).toContain('commitMigrationForSite');
    expect(importFlow).toContain("credentialMode: 'embedded-password'");
    expect(importFlow).not.toContain('fillOrThrow');
    expect(importFlow).not.toContain('prepareRegistrationForSite');
    expect(importFlow).not.toContain('encodePasswordDeterministically');
    expect(importFlow).not.toContain('saveCredentialContinuation');
    expect(importFlow).not.toContain('chrome.tabs.update');
  });

  it('fills embedded passwords directly and encodes only derived credentials', () => {
    const start = source.indexOf('async function handleAuthenticate');
    const end = source.indexOf('async function prepareRegistration', start);
    const authFlow = source.slice(start, end);
    expect(authFlow).toContain("recovered.kind === 'embedded-password'");
    expect(authFlow).toContain('websitePassword = recovered.password');
    expect(authFlow).toContain('secretForLs: recovered.secretForLs');
    expect(authFlow).toContain('passwordForLs: websitePassword');
  });

  it('does not offer website registration for login-only providers', () => {
    expect(source).toContain("activeSite?.registrationSupported !== false");
    expect(source).toContain("site.registrationSupported === false");
    expect(source).toContain('Import an existing password locally instead.');
  });
});
