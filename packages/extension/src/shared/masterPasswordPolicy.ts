export const MIN_MASTER_PASSWORD_LENGTH = 6;

export function meetsMasterPasswordLength(value: string): boolean {
  return value.length >= MIN_MASTER_PASSWORD_LENGTH;
}
