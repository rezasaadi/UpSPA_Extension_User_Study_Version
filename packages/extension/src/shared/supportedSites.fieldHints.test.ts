// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { SUPPORTED_PROTOTYPE_SITES, type SupportedPrototypeSite } from './supportedSites';

type HintKind = keyof NonNullable<SupportedPrototypeSite['fieldHints']>;

function site(siteId: string): SupportedPrototypeSite {
  const match = SUPPORTED_PROTOTYPE_SITES.find((candidate) => candidate.id === siteId);
  if (!match) throw new Error(`Missing test site: ${siteId}`);
  return match;
}

function hintedElements(siteId: string, kind: HintKind): Element[] {
  const matches: Element[] = [];
  for (const selector of site(siteId).fieldHints?.[kind] ?? []) {
    document.querySelectorAll(selector).forEach((element) => {
      if (!matches.includes(element)) matches.push(element);
    });
  }
  return matches;
}

function firstHintedElement(siteId: string, kind: HintKind): Element | undefined {
  for (const selector of site(siteId).fieldHints?.[kind] ?? []) {
    const match = document.querySelector(selector);
    if (match) return match;
  }
  return undefined;
}

function identifierSelectors(candidate: SupportedPrototypeSite): string[] {
  return [
    ...(candidate.fieldHints?.username ?? []),
    ...(candidate.fieldHints?.registrationUsername ?? []),
    ...(candidate.fieldHints?.email ?? []),
  ];
}

describe('audited provider field hints', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('selects Instagram account fields, including its intentional type=search username', () => {
    document.body.innerHTML = [
      '<form role="search"><input id="site-search" type="search" placeholder="Search"></form>',
      '<form><input id="signup-username" type="search" placeholder="Username"><input id="signup-password" type="password"></form>',
    ].join('');

    expect(firstHintedElement('instagram', 'username')?.id).toBe('signup-username');
    expect(hintedElements('instagram', 'username').map((element) => element.id)).not.toContain('site-search');

    document.body.innerHTML = [
      '<input id="login-account" autocomplete="username webauthn" aria-label="Mobile number, username or email">',
      '<input id="login-password" name="pass" type="password">',
    ].join('');

    expect(firstHintedElement('instagram', 'username')?.id).toBe('login-account');
    expect(firstHintedElement('instagram', 'password')?.id).toBe('login-password');
  });

  it('selects the audited staged identifiers for Amazon and Uber', () => {
    document.body.innerHTML = [
      '<input id="ap_email_login" name="email" type="email" autocomplete="webauthn">',
      '<input id="unrelated-search" name="search" type="search">',
    ].join('');
    expect(firstHintedElement('amazon', 'username')?.id).toBe('ap_email_login');

    document.body.innerHTML = [
      '<input id="PHONE_NUMBER_or_EMAIL_ADDRESS" name="email" type="email" autocomplete="email webauthn">',
      '<input id="unrelated-search" name="search" type="search">',
    ].join('');
    expect(firstHintedElement('uber', 'username')?.id).toBe('PHONE_NUMBER_or_EMAIL_ADDRESS');
  });

  it('selects eBay sign-up email/password without treating name fields as account IDs', () => {
    document.body.innerHTML = [
      '<input id="firstname" name="firstname" autocomplete="given-name">',
      '<input id="lastname" name="lastname" autocomplete="family-name">',
      '<input id="Email" name="Email" type="text" autocomplete="email">',
      '<input id="password" name="password" type="password" autocomplete="new-password">',
    ].join('');

    expect(firstHintedElement('ebay', 'username')?.id).toBe('Email');
    expect(firstHintedElement('ebay', 'newPassword')?.id).toBe('password');
    expect(hintedElements('ebay', 'username').map((element) => element.id)).toEqual(['Email']);
  });

  it('keeps GitHub login, registration username, and registration email hints separate', () => {
    document.body.innerHTML = [
      '<input id="signup-login" name="user[login]" autocomplete="username">',
      '<input id="signup-email" name="user[email]" type="email" autocomplete="email">',
      '<input id="login-field" name="login" autocomplete="username">',
    ].join('');

    expect(firstHintedElement('github', 'registrationUsername')?.id).toBe('signup-login');
    expect(firstHintedElement('github', 'email')?.id).toBe('signup-email');
    expect(firstHintedElement('github', 'username')?.id).toBe('login-field');
    expect(hintedElements('github', 'registrationUsername')).not.toContain(firstHintedElement('github', 'email'));
  });

  it('matches the exact identifier/password contracts observed in the browser audit', () => {
    const contracts: Array<{
      siteId: string;
      html: string;
      usernameId: string;
      passwordId?: string;
    }> = [
      {
        siteId: 'apple',
        html: '<input id="account_name_text_field" autocomplete="username webauthn"><input id="password_text_field" type="password">',
        usernameId: 'account_name_text_field',
        passwordId: 'password_text_field',
      },
      {
        siteId: 'x',
        html: '<input id="jf-input-username_or_email" name="username_or_email" autocomplete="username webauthn">',
        usernameId: 'jf-input-username_or_email',
      },
      {
        siteId: 'facebook',
        html: '<input id="facebook-email" name="email"><input id="facebook-pass" name="pass" type="password">',
        usernameId: 'facebook-email',
        passwordId: 'facebook-pass',
      },
      {
        siteId: 'linkedin',
        html: '<input id="linkedin-user" autocomplete="username"><input id="linkedin-pass" type="password" autocomplete="current-password">',
        usernameId: 'linkedin-user',
        passwordId: 'linkedin-pass',
      },
      {
        siteId: 'stackoverflow',
        html: '<input id="email"><input id="password" type="password">',
        usernameId: 'email',
        passwordId: 'password',
      },
      {
        siteId: 'dropbox',
        html: '<input id="dropbox-email" name="susi_email"><input id="dropbox-pass" name="login_password" type="password">',
        usernameId: 'dropbox-email',
        passwordId: 'dropbox-pass',
      },
      {
        siteId: 'notion',
        html: '<input id="notion-email" type="email" autocomplete="email"><input id="notion-pass" type="password" autocomplete="current-password">',
        usernameId: 'notion-email',
        passwordId: 'notion-pass',
      },
      {
        siteId: 'figma',
        html: '<input id="email"><input id="current-password" type="password">',
        usernameId: 'email',
        passwordId: 'current-password',
      },
      {
        siteId: 'spotify',
        html: '<input id="username" autocomplete="username" aria-label="Email">',
        usernameId: 'username',
      },
      {
        siteId: 'netflix',
        html: '<input id="netflix-email" name="userLoginId"><input id="netflix-pass" name="password" type="password">',
        usernameId: 'netflix-email',
        passwordId: 'netflix-pass',
      },
      {
        siteId: 'paypal',
        html: '<input id="email" name="login_email">',
        usernameId: 'email',
      },
      {
        siteId: 'twitch',
        html: '<input id="login-username"><input id="password-input" type="password">',
        usernameId: 'login-username',
        passwordId: 'password-input',
      },
      {
        siteId: 'yahoo',
        html: '<input id="username"><input id="password" type="password">',
        usernameId: 'username',
        passwordId: 'password',
      },
      {
        siteId: 'proton',
        html: '<input id="username"><input id="password" type="password">',
        usernameId: 'username',
        passwordId: 'password',
      },
      {
        siteId: 'wordpress',
        html: '<input id="usernameOrEmail" name="usernameOrEmail" autocomplete="username"><input id="password" name="password" type="password" autocomplete="current-password">',
        usernameId: 'usernameOrEmail',
        passwordId: 'password',
      },
      {
        siteId: 'quora',
        html: '<input id="email"><input id="password" type="password">',
        usernameId: 'email',
        passwordId: 'password',
      },
      {
        siteId: 'airbnb',
        html: '<input id="phone-or-email">',
        usernameId: 'phone-or-email',
      },
      {
        siteId: 'asana',
        html: '<input id="asana-login" name="e"><input id="email-input">',
        usernameId: 'asana-login',
      },
      {
        siteId: 'zoom',
        html: '<input id="email" name="account" aria-label="Email or phone number">',
        usernameId: 'email',
      },
      {
        siteId: 'adobe',
        html: '<input id="EmailPage-EmailField" name="username" autocomplete="email webauthn">',
        usernameId: 'EmailPage-EmailField',
      },
      {
        siteId: 'epicgames',
        html: '<input id="email" name="email" type="email" autocomplete="username"><input id="password" name="password" type="password" autocomplete="current-password">',
        usernameId: 'email',
        passwordId: 'password',
      },
    ];

    for (const contract of contracts) {
      document.body.innerHTML = contract.html;
      expect(firstHintedElement(contract.siteId, 'username')?.id, contract.siteId).toBe(contract.usernameId);
      if (contract.passwordId) {
        expect(firstHintedElement(contract.siteId, 'password')?.id, contract.siteId).toBe(contract.passwordId);
      }
    }

    document.body.innerHTML = '<input id="usernameEntry"><input id="signup-email" name="email">';
    expect(hintedElements('microsoft', 'username').map((element) => element.id)).toEqual([
      'usernameEntry',
      'signup-email',
    ]);

    document.body.innerHTML = '<input id="signup_email"><input id="creator_signup_email">';
    expect(hintedElements('slack', 'email').map((element) => element.id)).toEqual([
      'signup_email',
      'creator_signup_email',
    ]);

    document.body.innerHTML = [
      '<input id="apple-first-name" name="firstName">',
      '<input id="apple-last-name" name="lastName">',
      '<input id="apple-id" name="appleId" type="email">',
      '<input id="apple-new-password" name="password" type="password" autocomplete="new-password">',
      '<input id="apple-confirm-password" name="confirmPassword" type="password">',
      '<input id="apple-phone" name="phoneNumber" type="tel">',
    ].join('');
    expect(firstHintedElement('apple', 'email')?.id).toBe('apple-id');
    expect(hintedElements('apple', 'newPassword').map((element) => element.id)).toEqual([
      'apple-new-password',
      'apple-confirm-password',
    ]);
    expect(hintedElements('apple', 'email').map((element) => element.id)).not.toContain('apple-first-name');
    expect(hintedElements('apple', 'email').map((element) => element.id)).not.toContain('apple-phone');
  });

  it('keeps staged registration username and email selectors separate', () => {
    const contracts: Array<{
      siteId: string;
      html: string;
      registrationUsernameId: string;
      emailId: string;
    }> = [
      {
        siteId: 'instagram',
        html: '<input id="instagram-username" type="search" placeholder="Username"><input id="instagram-email" name="emailOrPhone">',
        registrationUsernameId: 'instagram-username',
        emailId: 'instagram-email',
      },
      {
        siteId: 'gitlab',
        html: '<input id="new_user_username" name="new_user[username]"><input id="new_user_email" name="new_user[email]" type="email">',
        registrationUsernameId: 'new_user_username',
        emailId: 'new_user_email',
      },
      {
        siteId: 'reddit',
        html: '<input id="reddit-username" name="username" autocomplete="username"><input id="reddit-email" name="email" autocomplete="email">',
        registrationUsernameId: 'reddit-username',
        emailId: 'reddit-email',
      },
      {
        siteId: 'discord',
        html: '<input id="discord-username" name="username" autocomplete="username"><input id="discord-email" name="email" type="email"><input id="discord-display" name="global_name">',
        registrationUsernameId: 'discord-username',
        emailId: 'discord-email',
      },
      {
        siteId: 'twitch',
        html: '<input id="signup-username"><input id="email-input" type="email">',
        registrationUsernameId: 'signup-username',
        emailId: 'email-input',
      },
      {
        siteId: 'steam',
        html: '<input id="accountname" name="accountname"><input id="email" name="email" type="email"><input id="steam-search" name="term">',
        registrationUsernameId: 'accountname',
        emailId: 'email',
      },
      {
        siteId: 'epicgames',
        html: '<input id="epic-username" name="username" autocomplete="username"><input id="email" name="email" type="email" autocomplete="username"><input id="epic-display" name="displayName">',
        registrationUsernameId: 'epic-username',
        emailId: 'email',
      },
      {
        siteId: 'wordpress',
        html: '<input id="username" name="username"><input id="email" name="email" type="email">',
        registrationUsernameId: 'username',
        emailId: 'email',
      },
    ];

    for (const contract of contracts) {
      document.body.innerHTML = contract.html;
      expect(firstHintedElement(contract.siteId, 'registrationUsername')?.id, contract.siteId)
        .toBe(contract.registrationUsernameId);
      expect(firstHintedElement(contract.siteId, 'email')?.id, contract.siteId).toBe(contract.emailId);
      expect(hintedElements(contract.siteId, 'registrationUsername').map((element) => element.id), contract.siteId)
        .not.toContain(contract.emailId);
    }
  });

  it('selects Box sign-up email/password without treating full name as the account ID', () => {
    document.body.innerHTML = [
      '<input id="box-name" name="fullName" type="text">',
      '<input id="box-email" name="email" type="text">',
      '<input id="box-password" name="password" type="password" autocomplete="off">',
    ].join('');

    expect(firstHintedElement('box', 'username')?.id).toBe('box-email');
    expect(firstHintedElement('box', 'newPassword')?.id).toBe('box-password');
    expect(hintedElements('box', 'username').map((element) => element.id)).toEqual(['box-email']);
  });

  it('keeps Booking staging and Steam/Pinterest site-search inputs out of provider hints', () => {
    document.body.innerHTML = [
      '<input id="username" name="username" type="email" autocomplete="username">',
      '<input id="hidden-password" name="password" type="password" autocomplete="current-password">',
    ].join('');
    expect(firstHintedElement('booking', 'username')?.id).toBe('username');
    expect(hintedElements('booking', 'password')).toEqual([]);

    document.body.innerHTML = [
      '<input id="steam-search" name="term" autocomplete="off">',
      '<input id="steam-email" name="email" type="email">',
    ].join('');
    expect(firstHintedElement('steam', 'username')?.id).toBe('steam-email');
    expect(hintedElements('steam', 'username').map((element) => element.id)).not.toContain('steam-search');

    document.body.innerHTML = [
      '<input id="searchBoxInput" name="search-input">',
      '<input id="email" name="id" type="email" autocomplete="email">',
      '<input id="password" name="password" type="password" autocomplete="new-password">',
    ].join('');
    expect(firstHintedElement('pinterest', 'username')?.id).toBe('email');
    expect(firstHintedElement('pinterest', 'newPassword')?.id).toBe('password');
    expect(hintedElements('pinterest', 'username').map((element) => element.id)).not.toContain('searchBoxInput');
  });

  it('does not introduce broad selectors that opt arbitrary search inputs into autofill', () => {
    const audited = ['instagram', 'amazon', 'ebay', 'uber', 'booking', 'steam', 'pinterest', 'box'];
    for (const siteId of audited) {
      for (const selector of site(siteId).fieldHints?.username ?? []) {
        if (/^input\[type=["']?search/i.test(selector)) {
          expect(selector, `${siteId}: ${selector}`).toContain('[placeholder="Username"]');
        }
        expect(selector, `${siteId}: ${selector}`).not.toMatch(/^input\[type=["']?search["']?\]$/i);
      }
    }

    expect(site('instagram').fieldHints?.username?.[0]).toBe(
      'input[type="search"][placeholder="Username"]',
    );
  });

  it('gives every password-capable provider at least one scoped identifier hint', () => {
    for (const candidate of SUPPORTED_PROTOTYPE_SITES) {
      if (candidate.credentialMode === 'passwordless') {
        expect(candidate.id).toBe('medium');
        continue;
      }

      const selectors = identifierSelectors(candidate);
      expect(selectors.length, candidate.id).toBeGreaterThan(0);
      for (const selector of selectors) {
        expect(() => document.querySelectorAll(selector), `${candidate.id}: ${selector}`).not.toThrow();
        expect(selector, `${candidate.id}: ${selector}`).toMatch(
          /#[a-z0-9_-]+|\[(?:name|autocomplete|aria-label|placeholder)[~*^$|]?=/i,
        );
        expect(selector, `${candidate.id}: ${selector}`).not.toMatch(
          /^input(?:\[type=["']?(?:text|email|tel|search)["']?\])?$/i,
        );
      }
    }
  });

  it('never points provider identifier hints at search, profile, display-name, or DOB fixtures', () => {
    document.body.innerHTML = [
      '<form id="site-search"><input id="global-search" name="q" type="search" placeholder="Search"></form>',
      '<form id="profile"><input id="profile-email" name="profile_email" type="email" autocomplete="off"><input id="profile-username" name="profile_username" autocomplete="off"><input id="display-name" name="global_name" autocomplete="name"></form>',
      '<form id="date-of-birth"><input id="birth-date" name="birthday" type="date" autocomplete="bday"><input id="birth-month" name="month" autocomplete="bday-month"><input id="birth-day" name="day" autocomplete="bday-day"><input id="birth-year" name="year" autocomplete="bday-year"></form>',
    ].join('');
    const forbiddenIds = new Set([
      'global-search',
      'profile-email',
      'profile-username',
      'display-name',
      'birth-date',
      'birth-month',
      'birth-day',
      'birth-year',
    ]);

    for (const candidate of SUPPORTED_PROTOTYPE_SITES) {
      for (const kind of ['username', 'registrationUsername', 'email'] as const) {
        const matches = hintedElements(candidate.id, kind).map((element) => element.id);
        expect(matches.filter((id) => forbiddenIds.has(id)), `${candidate.id}.${kind}`).toEqual([]);
      }
    }
  });
});
