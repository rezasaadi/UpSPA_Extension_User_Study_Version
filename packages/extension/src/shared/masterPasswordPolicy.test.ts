import { describe, expect, it } from 'vitest';
import { MIN_MASTER_PASSWORD_LENGTH, meetsMasterPasswordLength } from './masterPasswordPolicy';

describe('relaxed master-password policy', () => {
  it('accepts six characters and rejects shorter passwords', () => {
    expect(MIN_MASTER_PASSWORD_LENGTH).toBe(6);
    expect(meetsMasterPasswordLength('abcdef')).toBe(true);
    expect(meetsMasterPasswordLength('abcde')).toBe(false);
  });
});
