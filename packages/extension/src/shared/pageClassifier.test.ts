import { describe, expect, it } from 'vitest';
import { applyDetectedFormFallback, classifyPage } from './pageClassifier';

describe('hardcoded page classification', () => {
  it('uses password-change, sign-up, and login routes in that priority order', () => {
    expect(classifyPage('https://github.com/settings/security').kind).toBe('password-change');
    expect(classifyPage('https://github.com/signup').kind).toBe('sign-up');
    expect(classifyPage('https://github.com/login').kind).toBe('login');
    expect(classifyPage('https://github.com/features').kind).toBe('dashboard');
  });

  it('does not use saved-account state to classify a page', () => {
    expect(classifyPage('https://accounts.google.com/signin/v2/identifier').kind).toBe('login');
    expect(classifyPage('https://account.proton.me/start').kind).toBe('sign-up');
    expect(classifyPage('https://app.notion.com/login').kind).toBe('login');
    expect(classifyPage('https://wordpress.com/setup/onboarding/user').kind).toBe('sign-up');
    expect(classifyPage('https://example.invalid/login').kind).toBe('unsupported');
  });

  it('matches hardcoded localized route patterns without classifying the whole host', () => {
    expect(classifyPage('https://www.spotify.com/tr-tr/signup').kind).toBe('sign-up');
    expect(classifyPage('https://accounts.spotify.com/en/login').kind).toBe('login');
    expect(classifyPage('https://www.spotify.com/tr-tr/account/overview').kind).toBe('dashboard');
  });

  it('distinguishes hash routes and shared authentication pages', () => {
    expect(classifyPage('https://auth.services.adobe.com/en_US/deeplink.html#/register').kind).toBe('sign-up');
    expect(classifyPage('https://auth.services.adobe.com/en_US/deeplink.html#/signin').kind).toBe('login');
    expect(classifyPage('https://account.adobe.com/').kind).toBe('auth-choice');
    expect(classifyPage('https://www.airbnb.com/signup_login').kind).toBe('auth-choice');
    expect(classifyPage('https://www.quora.com/some-topic').kind).toBe('dashboard');
  });

  it('uses a known visible form as fresher evidence than a supported static route', () => {
    expect(applyDetectedFormFallback('dashboard', 'register')).toBe('sign-up');
    expect(applyDetectedFormFallback('auth-choice', 'login')).toBe('login');
    expect(applyDetectedFormFallback('login', 'register')).toBe('sign-up');
    expect(applyDetectedFormFallback('sign-up', 'login')).toBe('login');
    expect(applyDetectedFormFallback('login', 'password-update')).toBe('password-change');
  });

  it('keeps the route when visible-form detection is unknown and never promotes unsupported origins', () => {
    expect(applyDetectedFormFallback('login', 'unknown')).toBe('login');
    expect(applyDetectedFormFallback('sign-up', 'unknown')).toBe('sign-up');
    expect(applyDetectedFormFallback('auth-choice', 'unknown')).toBe('auth-choice');
    expect(applyDetectedFormFallback('unsupported', 'login')).toBe('unsupported');
  });
});
