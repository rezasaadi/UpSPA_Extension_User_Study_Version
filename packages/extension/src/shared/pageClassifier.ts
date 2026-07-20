import { getSupportedSiteForUrl, hostnameMatches, type SupportedPrototypeSite } from './supportedSites';

export type SitePageKind = 'password-change' | 'sign-up' | 'login' | 'auth-choice' | 'dashboard' | 'unsupported';

export type PageClassification = {
  kind: SitePageKind;
  url: string;
  site?: SupportedPrototypeSite;
};

function canonicalPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '');
  return path || '/';
}

function routeMatches(url: URL, route: string | undefined): boolean {
  if (!route) return false;

  let target: URL;
  try {
    target = new URL(route);
  } catch {
    return false;
  }

  if (!hostnameMatches(url.hostname, target.hostname)) return false;

  const targetPath = canonicalPath(target.pathname);
  const currentPath = canonicalPath(url.pathname);
  const wildcard = route.includes('*');
  const pathMatches = wildcard
    ? new RegExp(`^${targetPath.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(currentPath)
    : targetPath === '/'
      ? currentPath === '/'
      : currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
  if (!pathMatches) {
    return false;
  }

  let queryMatches = true;
  target.searchParams.forEach((value, key) => {
    if (url.searchParams.get(key) !== value) queryMatches = false;
  });
  if (!queryMatches) return false;
  if (target.hash && !url.hash.startsWith(target.hash)) return false;
  return true;
}

function anyRouteMatches(url: URL, primary: string | undefined, aliases: string[] | undefined): boolean {
  return [primary, ...(aliases ?? [])].some((route) => routeMatches(url, route));
}

export function classifySupportedPage(site: SupportedPrototypeSite, url: string): SitePageKind {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'unsupported';
  }

  // A password-change route wins when providers reuse a host or route prefix.
  if (anyRouteMatches(parsed, site.passwordChangeUrl, site.passwordChangeUrls)) return 'password-change';
  const signupMatches = site.registrationSupported !== false
    && anyRouteMatches(parsed, site.signupUrl, site.signupUrls);
  const loginMatches = anyRouteMatches(parsed, site.loginUrl, site.loginUrls);
  if (signupMatches && loginMatches) return 'auth-choice';
  if (signupMatches) return 'sign-up';
  if (loginMatches) return 'login';
  return 'dashboard';
}

export function classifyPage(url: string | undefined): PageClassification {
  const safeUrl = url ?? '';
  const site = getSupportedSiteForUrl(safeUrl);
  if (!site) return { kind: 'unsupported', url: safeUrl };
  return { kind: classifySupportedPage(site, safeUrl), site, url: safeUrl };
}

export function applyDetectedFormFallback(
  pageKind: SitePageKind,
  formType: 'login' | 'register' | 'password-update' | 'unknown',
): SitePageKind {
  // Detection is produced from the currently visible credential form. Once it
  // is known, it is more current than the URL: many providers keep a single
  // route while switching between sign-in and registration client-side.
  // Never promote an unsupported origin based on DOM contents alone.
  if (pageKind === 'unsupported' || formType === 'unknown') return pageKind;
  if (formType === 'register') return 'sign-up';
  if (formType === 'login') return 'login';
  if (formType === 'password-update') return 'password-change';
  return pageKind;
}
