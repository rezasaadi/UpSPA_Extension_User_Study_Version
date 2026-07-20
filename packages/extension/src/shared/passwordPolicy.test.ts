import { beforeAll, describe, expect, test } from 'vitest';
// Test-only Node WebCrypto shim for Vitest's node environment.
// @ts-ignore Node types are not part of the extension tsconfig.
import { readFileSync } from 'node:fs';
// @ts-ignore Node types are not part of the extension tsconfig.
import { webcrypto } from 'node:crypto';
import {
  defaultPasswordPolicy,
  encodePasswordDeterministically,
  encodeSecretAsPassword,
  inferPasswordPolicyFromText,
  normalizePasswordPolicy,
  parseApplePasswordRules,
  passwordSatisfiesPolicy,
} from './passwordPolicy';

const SECRET = 'raw-upspa-secret-for-tests';

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
  }
  if (!globalThis.btoa) {
    Object.defineProperty(globalThis, 'btoa', {
      value: (input: string) => Buffer.from(input, 'binary').toString('base64'),
      configurable: true,
    });
  }
});

describe('deterministic password encoding', () => {
  const baseParams = {
    vinfo: SECRET,
    origin: 'https://login.example',
    uid: 'main-upspa-uid',
    suid: 'site-suid',
    counter: 3,
    policy: defaultPasswordPolicy(),
  };

  test('same input gives the same password', async () => {
    const a = await encodePasswordDeterministically(baseParams);
    const b = await encodePasswordDeterministically(baseParams);
    expect(a.password).toBe(b.password);
    expect(a.counter).toBe(3);
  });

  test('different counter gives a different password', async () => {
    const a = await encodePasswordDeterministically({ ...baseParams, counter: 3 });
    const b = await encodePasswordDeterministically({ ...baseParams, counter: 4 });
    expect(a.password).not.toBe(b.password);
  });

  test('different origin gives a different password', async () => {
    const a = await encodePasswordDeterministically({ ...baseParams, origin: 'https://a.example' });
    const b = await encodePasswordDeterministically({ ...baseParams, origin: 'https://b.example' });
    expect(a.password).not.toBe(b.password);
  });

  test('respects min and max length', async () => {
    const policy = normalizePasswordPolicy({ minLength: 12, maxLength: 16 });
    const out = await encodePasswordDeterministically({ ...baseParams, policy });
    expect(out.password.length).toBeGreaterThanOrEqual(12);
    expect(out.password.length).toBeLessThanOrEqual(16);
  });

  test('includes all required classes', async () => {
    const policy = normalizePasswordPolicy({
      minLength: 12,
      maxLength: 24,
      requireUppercase: true,
      requireLowercase: true,
      requireDigit: true,
      requireSpecial: true,
      allowedSpecials: '@#',
    });
    const out = await encodePasswordDeterministically({ ...baseParams, policy });
    expect(/[A-Z]/.test(out.password)).toBe(true);
    expect(/[a-z]/.test(out.password)).toBe(true);
    expect(/[0-9]/.test(out.password)).toBe(true);
    expect(Array.from(out.password).some((ch) => '@#'.includes(ch))).toBe(true);
    expect(passwordSatisfiesPolicy(out.password, policy, baseParams.uid)).toBe(true);
  });

  test('does not use Math.random', () => {
    const source = readFileSync(new URL('./passwordPolicy.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('Math.random');
  });

  test('legacy encoder remains deterministic for old records', async () => {
    const policy = defaultPasswordPolicy();
    const a = await encodeSecretAsPassword(SECRET, policy, 'alice@example.com', 1);
    const b = await encodeSecretAsPassword(SECRET, policy, 'alice@example.com', 1);
    expect(a).toEqual(b);
  });
});

describe('password policy parsing helpers', () => {
  test('normalizes minlength and maxlength examples', () => {
    const policy = normalizePasswordPolicy({ minLength: 8, maxLength: 64 });
    expect(policy.minLength).toBe(8);
    expect(policy.maxLength).toBe(64);
  });

  test('extracts common visible-text requirements', () => {
    const policy = normalizePasswordPolicy(
      inferPasswordPolicyFromText('Use at least 8 characters, one uppercase letter, one number.'),
    );
    expect(policy.minLength).toBe(8);
    expect(policy.requireUppercase).toBe(true);
    expect(policy.requireDigit).toBe(true);
    expect(policy.source).toContain('visible-text');
  });

  test('extracts special-character visible text', () => {
    const policy = normalizePasswordPolicy(
      inferPasswordPolicyFromText('Password must contain a special character.'),
    );
    expect(policy.requireSpecial).toBe(true);
  });

  test('parses Apple passwordrules', () => {
    const policy = normalizePasswordPolicy(
      parseApplePasswordRules('minlength: 12; required: upper; required: digit; required: special;'),
    );
    expect(policy.minLength).toBe(12);
    expect(policy.requireUppercase).toBe(true);
    expect(policy.requireDigit).toBe(true);
    expect(policy.requireSpecial).toBe(true);
    expect(policy.source).toContain('passwordrules');
  });

  test('safe defaults apply when no visible policy exists', () => {
    const policy = normalizePasswordPolicy({});
    expect(policy.minLength).toBe(20);
    expect(policy.requireUppercase).toBe(true);
    expect(policy.requireLowercase).toBe(true);
    expect(policy.requireDigit).toBe(true);
    expect(policy.requireSpecial).toBe(true);
  });
});
