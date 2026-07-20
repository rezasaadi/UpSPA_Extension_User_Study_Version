import { describe, expect, it } from 'vitest';
import { getSupportedSiteForUrl, hostnameMatches, SUPPORTED_PROTOTYPE_SITES } from './supportedSites';

describe('supported prototype sites', () => {
  it('matches hostnames and subdomains in the curated registry', () => {
    expect(getSupportedSiteForUrl('https://www.github.com/login')?.id).toBe('github');
    expect(getSupportedSiteForUrl('https://accounts.google.com/signin')?.id).toBe('google');
    expect(getSupportedSiteForUrl('https://app.notion.com/login')?.id).toBe('notion');
    expect(getSupportedSiteForUrl('https://x.com/i/flow/login')?.id).toBe('x');
  });

  it('does not match unknown hosts', () => {
    expect(getSupportedSiteForUrl('https://example.invalid/login')).toBeUndefined();
    expect(getSupportedSiteForUrl('chrome://extensions')).toBeUndefined();
    expect(getSupportedSiteForUrl(undefined)).toBeUndefined();
  });

  it('normalizes common www prefixes', () => {
    expect(hostnameMatches('www.github.com', 'github.com')).toBe(true);
    expect(hostnameMatches('evilgithub.com', 'github.com')).toBe(false);
  });

  it('hardcodes login and sign-up routes and enables multi-step continuation for all 40 sites', () => {
    expect(SUPPORTED_PROTOTYPE_SITES).toHaveLength(40);
    for (const site of SUPPORTED_PROTOTYPE_SITES) {
      expect(new URL(site.loginUrl).protocol).toBe('https:');
      expect(new URL(site.signupUrl).protocol).toBe('https:');
      expect(site.multiStep).toEqual({ login: true, signup: true, passwordChange: true });
      const routes = [
        site.loginUrl,
        site.signupUrl,
        site.passwordChangeUrl,
        ...(site.loginUrls ?? []),
        ...(site.signupUrls ?? []),
        ...(site.passwordChangeUrls ?? []),
      ].filter((route): route is string => Boolean(route));
      for (const route of routes) {
        expect(getSupportedSiteForUrl(route)?.id, `${site.id}: ${route}`).toBe(site.id);
      }
    }
  });

  it('uses a stable, registered HTTPS credential origin for every site', () => {
    for (const site of SUPPORTED_PROTOTYPE_SITES) {
      const credentialUrl = new URL(site.credentialOrigin);
      expect(credentialUrl.protocol, site.id).toBe('https:');
      expect(credentialUrl.origin, site.id).toBe(site.credentialOrigin);
      expect(credentialUrl.pathname, site.id).toBe('/');
      expect(credentialUrl.search, site.id).toBe('');
      expect(credentialUrl.hash, site.id).toBe('');
      expect(getSupportedSiteForUrl(site.credentialOrigin)?.id, site.id).toBe(site.id);

      const expectedOrigin = site.id === 'bitbucket'
        ? 'https://id.atlassian.com'
        : site.id === 'uber'
          ? 'https://auth.uber.com'
          : new URL(site.loginUrl).origin;
      expect(site.credentialOrigin, site.id).toBe(expectedOrigin);
    }
  });

  it('includes the audited authentication aliases for critical providers', () => {
    const cases = [
      ['amazon', 'https://www.amazon.com/gp/sign-in.html?openid.return_to=https%3A%2F%2Fwww.amazon.com%2F'],
      ['box', 'https://account.box.com/signup/n/personal?tc=annual'],
      ['box', 'https://account.box.com/signup/personal?tc=annual'],
      ['uber', 'https://account.uber.com/'],
      ['apple', 'https://idmsa.apple.com/appleauth/auth/signin'],
      ['microsoft', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'],
      ['microsoft', 'https://signup.live.com/signup'],
      ['x', 'https://x.com/login'],
      ['x', 'https://twitter.com/signup'],
      ['ebay', 'https://signup.ebay.com/pa/crte'],
      ['notion', 'https://app.notion.com/login'],
    ] as const;

    for (const [siteId, route] of cases) {
      expect(getSupportedSiteForUrl(route)?.id, route).toBe(siteId);
    }
  });
});
