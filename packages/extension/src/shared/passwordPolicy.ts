export type PasswordPolicySource =
  | 'html-attributes'
  | 'passwordrules'
  | 'visible-text'
  | 'manual'
  | 'domain-quirk'
  | 'default';

export type PasswordPolicy = {
  version: 1;
  minLength: number;
  maxLength: number;
  requireLowercase: boolean;
  requireUppercase: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  allowedSpecials: string;
  disallowedChars: string;
  pattern?: string;
  source: PasswordPolicySource[];
  rawText?: string;
  forbiddenSubstrings?: string[];
};

type LegacyPasswordPolicyFields = {
  minLen?: number;
  maxLen?: number;
  requireUpper?: boolean;
  requireLower?: boolean;
  requireSymbol?: boolean;
  allowedSymbols?: string;
  forbidWhitespace?: boolean;
};

export type PasswordPolicyInput = Partial<PasswordPolicy> & LegacyPasswordPolicyFields;

export type DeterministicPasswordMetadata = {
  version: 1;
  algorithm: 'upspa-hkdf-sha256-policy-v1' | 'upspa-sha256-policy-legacy-v0';
  origin: string;
  uid: string;
  suid: string;
  counter: number;
  policyHash: string;
  attempt?: number;
};

export type PasswordPolicyState = {
  policy: PasswordPolicy;
  encoderCounter: number;
  passwordMetadata?: DeterministicPasswordMetadata;
};

export type EncodedPasswordResult = {
  password: string;
  counter: number;
  attempt: number;
  metadata?: DeterministicPasswordMetadata;
};

export type DeterministicPasswordParams = {
  vinfo: Uint8Array | string;
  origin: string;
  uid: string;
  suid: string;
  counter: number;
  policy: PasswordPolicyInput;
};

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGIT = '0123456789';
const DEFAULT_SPECIALS = '!@#$%^&*';
const MAX_ATTEMPTS = 128;
const DEFAULT_PASSWORD_LENGTH = 20;
const encoder = new TextEncoder();

export function defaultPasswordPolicy(): PasswordPolicy {
  return {
    version: 1,
    minLength: DEFAULT_PASSWORD_LENGTH,
    maxLength: 32,
    requireLowercase: true,
    requireUppercase: true,
    requireDigit: true,
    requireSpecial: true,
    allowedSpecials: DEFAULT_SPECIALS,
    disallowedChars: '',
    source: ['default'],
    forbiddenSubstrings: [],
  };
}

function uniqueChars(input: string): string {
  const seen = new Set<string>();
  let out = '';
  for (const ch of input || '') {
    if (seen.has(ch)) continue;
    seen.add(ch);
    out += ch;
  }
  return out;
}

function uniqueSources(sources: Array<PasswordPolicySource | undefined>): PasswordPolicySource[] {
  const seen = new Set<PasswordPolicySource>();
  const out: PasswordPolicySource[] = [];
  for (const source of sources) {
    if (!source || seen.has(source)) continue;
    seen.add(source);
    out.push(source);
  }
  return out.length > 0 ? out : ['manual'];
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function removeChars(input: string, disallowed: string): string {
  if (!disallowed) return input;
  return Array.from(input)
    .filter((ch) => !disallowed.includes(ch))
    .join('');
}

export function normalizePasswordPolicy(policy: PasswordPolicyInput = {}): PasswordPolicy {
  const defaults = defaultPasswordPolicy();
  const minFromInput = policy.minLength ?? policy.minLen;
  const maxFromInput = policy.maxLength ?? policy.maxLen;
  const minLength = Math.max(1, numberOr(minFromInput, defaults.minLength));
  const requestedMax = numberOr(maxFromInput, defaults.maxLength);
  const maxLength = Math.max(minLength, Math.min(Math.max(1, requestedMax), 128));
  const disallowedChars = uniqueChars(
    `${policy.disallowedChars ?? ''}${policy.forbidWhitespace ? ' \t\r\n' : ''}`,
  );
  let allowedSpecials = uniqueChars(
    String(policy.allowedSpecials ?? policy.allowedSymbols ?? defaults.allowedSpecials),
  );
  allowedSpecials = removeChars(allowedSpecials, disallowedChars);

  const requireSpecial = Boolean(policy.requireSpecial ?? policy.requireSymbol ?? defaults.requireSpecial);
  if (requireSpecial && !allowedSpecials) allowedSpecials = removeChars(DEFAULT_SPECIALS, disallowedChars);
  if (requireSpecial && !allowedSpecials) {
    throw new Error('Password policy is impossible: no allowed special characters remain.');
  }

  const source = policy.source?.length
    ? uniqueSources(policy.source)
    : uniqueSources([defaults.source[0], policy.rawText ? 'visible-text' : undefined]);

  return {
    version: 1,
    minLength,
    maxLength,
    requireLowercase: Boolean(policy.requireLowercase ?? policy.requireLower ?? defaults.requireLowercase),
    requireUppercase: Boolean(policy.requireUppercase ?? policy.requireUpper ?? defaults.requireUppercase),
    requireDigit: Boolean(policy.requireDigit ?? defaults.requireDigit),
    requireSpecial,
    allowedSpecials,
    disallowedChars,
    pattern: policy.pattern || undefined,
    source,
    rawText: policy.rawText,
    forbiddenSubstrings: (policy.forbiddenSubstrings ?? [])
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  };
}

function canonicalPolicyObject(policy: PasswordPolicyInput): PasswordPolicy {
  const normalized = normalizePasswordPolicy(policy);
  return {
    ...normalized,
    source: [...normalized.source].sort(),
    forbiddenSubstrings: [...(normalized.forbiddenSubstrings ?? [])].sort(),
  };
}

export function canonicalPasswordPolicy(policy: PasswordPolicyInput): string {
  return JSON.stringify(canonicalPolicyObject(policy));
}

export async function passwordPolicyHash(policy: PasswordPolicyInput): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalPasswordPolicy(policy)));
  return toBase64Url(new Uint8Array(digest));
}

function legacyPolicyObject(policy: PasswordPolicyInput): Record<string, unknown> {
  const normalized = normalizePasswordPolicy(policy);
  return {
    minLen: normalized.minLength,
    maxLen: normalized.maxLength,
    requireUpper: normalized.requireUppercase,
    requireLower: normalized.requireLowercase,
    requireDigit: normalized.requireDigit,
    requireSymbol: normalized.requireSpecial,
    allowedSymbols: normalized.allowedSpecials,
    forbidWhitespace: /[\s]/.test(normalized.disallowedChars),
    forbiddenSubstrings: normalized.forbiddenSubstrings ?? [],
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function vinfoToBytes(vinfo: Uint8Array | string): Uint8Array {
  if (vinfo instanceof Uint8Array) return vinfo;
  return encoder.encode(vinfo);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return new Uint8Array(digest);
}

async function expandLegacyBytes(seed: string, length: number): Promise<Uint8Array> {
  const chunks: number[] = [];
  let block = 0;
  while (chunks.length < length) {
    const digest = await sha256Bytes(`${seed}|block=${block}`);
    chunks.push(...digest);
    block += 1;
  }
  return new Uint8Array(chunks.slice(0, length));
}

async function deriveHkdfBytes(params: DeterministicPasswordParams, attempt: number, length: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(vinfoToBytes(params.vinfo)),
    'HKDF',
    false,
    ['deriveBits'],
  );
  const policy = canonicalPasswordPolicy(params.policy);
  const salt = encoder.encode(
    JSON.stringify({
      origin: params.origin,
      uid: params.uid,
      suid: params.suid,
      counter: params.counter,
      attempt,
      policy,
    }),
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(encoder.encode('upspa-password-encoder-v1')),
    },
    keyMaterial,
    length * 8,
  );
  return new Uint8Array(bits);
}

function pickChar(charset: string, byte: number): string {
  if (!charset) throw new Error('Password policy is impossible: empty character set.');
  return charset[byte % charset.length];
}

function requiredCharsets(policy: PasswordPolicy): string[] {
  const disallowed = policy.disallowedChars;
  const charsets: string[] = [];
  if (policy.requireLowercase) charsets.push(removeChars(LOWER, disallowed));
  if (policy.requireUppercase) charsets.push(removeChars(UPPER, disallowed));
  if (policy.requireDigit) charsets.push(removeChars(DIGIT, disallowed));
  if (policy.requireSpecial) charsets.push(removeChars(policy.allowedSpecials, disallowed));
  if (charsets.some((charset) => charset.length === 0)) {
    throw new Error('Password policy is impossible: a required character class is fully disallowed.');
  }
  return charsets;
}

function allowedPool(policy: PasswordPolicy): string {
  return uniqueChars(
    removeChars(`${LOWER}${UPPER}${DIGIT}${policy.allowedSpecials}`, policy.disallowedChars),
  );
}

function buildCandidate(chars: string[], shuffleBytes: Uint8Array): string {
  const out = [...chars];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = shuffleBytes[i] % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out.join('');
}

function chooseLength(policy: PasswordPolicy, requiredCount: number): number {
  const desired = Math.max(policy.minLength, DEFAULT_PASSWORD_LENGTH, requiredCount);
  return Math.min(policy.maxLength, desired);
}

function matchesPattern(password: string, pattern: string | undefined): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(password);
  } catch {
    return true;
  }
}

export function passwordSatisfiesPolicy(
  password: string,
  rawPolicy: PasswordPolicyInput,
  accountId?: string,
): boolean {
  const policy = normalizePasswordPolicy(rawPolicy);
  if (password.length < policy.minLength || password.length > policy.maxLength) return false;
  if (policy.requireUppercase && !/[A-Z]/.test(password)) return false;
  if (policy.requireLowercase && !/[a-z]/.test(password)) return false;
  if (policy.requireDigit && !/[0-9]/.test(password)) return false;
  if (policy.requireSpecial && !Array.from(password).some((ch) => policy.allowedSpecials.includes(ch))) {
    return false;
  }
  if (Array.from(password).some((ch) => policy.disallowedChars.includes(ch))) return false;
  if (!matchesPattern(password, policy.pattern)) return false;

  const lowerPassword = password.toLowerCase();
  for (const forbidden of policy.forbiddenSubstrings ?? []) {
    if (forbidden && lowerPassword.includes(forbidden)) return false;
  }
  const cleanAccountId = accountId?.trim().toLowerCase();
  if (cleanAccountId && lowerPassword.includes(cleanAccountId)) return false;

  return true;
}

async function buildPasswordFromBytes(
  bytes: Uint8Array,
  policy: PasswordPolicy,
): Promise<string> {
  const required = requiredCharsets(policy);
  if (required.length > policy.maxLength) {
    throw new Error('Password policy is impossible: more required classes than maximum length.');
  }

  const pool = allowedPool(policy);
  if (!pool) throw new Error('Password policy is impossible: no allowed character set.');

  const length = chooseLength(policy, required.length);
  const chars: string[] = [];

  for (let i = 0; i < required.length; i += 1) {
    chars.push(pickChar(required[i], bytes[i]));
  }
  for (let i = required.length; i < length; i += 1) {
    chars.push(pickChar(pool, bytes[i]));
  }

  return buildCandidate(chars, bytes.slice(length, length * 2));
}

export async function encodePasswordDeterministically(
  params: DeterministicPasswordParams,
): Promise<EncodedPasswordResult> {
  const policy = normalizePasswordPolicy(params.policy);
  const required = requiredCharsets(policy);
  const length = chooseLength(policy, required.length);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const bytes = await deriveHkdfBytes(params, attempt, length * 2 + required.length);
    const password = await buildPasswordFromBytes(bytes, policy);
    if (passwordSatisfiesPolicy(password, policy, params.uid)) {
      const metadata: DeterministicPasswordMetadata = {
        version: 1,
        algorithm: 'upspa-hkdf-sha256-policy-v1',
        origin: params.origin,
        uid: params.uid,
        suid: params.suid,
        counter: params.counter,
        policyHash: await passwordPolicyHash(policy),
        attempt,
      };
      return { password, counter: params.counter, attempt, metadata };
    }
  }

  throw new Error('Could not encode a password that satisfies the site policy. Adjust the policy and try again.');
}

export async function encodeSecretAsPassword(
  secretB64: string,
  rawPolicy: PasswordPolicyInput,
  accountId?: string,
  counter = 0,
): Promise<EncodedPasswordResult> {
  const policy = normalizePasswordPolicy(rawPolicy);
  const required = requiredCharsets(policy);
  const length = chooseLength(policy, required.length);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const seed = [
      'upspa-password-encoding-v1',
      secretB64,
      JSON.stringify(legacyPolicyObject(policy)),
      accountId?.trim().toLowerCase() ?? '',
      String(counter),
      String(attempt),
    ].join('|');
    const bytes = await expandLegacyBytes(seed, length * 2 + required.length);
    const password = await buildPasswordFromBytes(bytes, policy);
    if (passwordSatisfiesPolicy(password, policy, accountId)) {
      return { password, counter, attempt };
    }
  }

  throw new Error('Could not encode a password that satisfies the site policy. Adjust the policy and try again.');
}

function mergePolicyInputs(base: PasswordPolicyInput, patch: PasswordPolicyInput): PasswordPolicyInput {
  return {
    ...base,
    ...patch,
    source: uniqueSources([...(base.source ?? []), ...(patch.source ?? [])]),
    rawText: [base.rawText, patch.rawText].filter(Boolean).join(' '),
  };
}

function parseInteger(value: string): number | undefined {
  const match = value.match(/\d{1,3}/);
  return match ? Number(match[0]) : undefined;
}

function parseSpecialClass(raw: string): string {
  const custom = raw.match(/\[([^\]]+)\]/);
  if (custom) return uniqueChars(custom[1].replace(/\\/g, ''));
  if (/special|symbol|ascii-printable|unicode/i.test(raw)) return DEFAULT_SPECIALS;
  return '';
}

export function parseApplePasswordRules(rules: string): PasswordPolicyInput {
  let hints: PasswordPolicyInput = {
    source: ['passwordrules'],
    rawText: rules,
  };

  const statements = String(rules)
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

  for (const statement of statements) {
    const [rawKey, ...rawValueParts] = statement.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rawValueParts.join(':').trim();
    const lowerValue = value.toLowerCase();

    if (key === 'minlength') {
      const parsed = parseInteger(value);
      if (parsed !== undefined) hints.minLength = parsed;
    }
    if (key === 'maxlength') {
      const parsed = parseInteger(value);
      if (parsed !== undefined) hints.maxLength = parsed;
    }
    if (key === 'required') {
      if (/lower/.test(lowerValue)) hints.requireLowercase = true;
      if (/upper/.test(lowerValue)) hints.requireUppercase = true;
      if (/digit|number/.test(lowerValue)) hints.requireDigit = true;
      const specials = parseSpecialClass(value);
      if (/special|symbol|ascii-printable|unicode|\[[^\]]+\]/i.test(value)) {
        hints.requireSpecial = true;
        hints.allowedSpecials = uniqueChars(`${hints.allowedSpecials ?? ''}${specials}`) || DEFAULT_SPECIALS;
      }
    }
    if (key === 'allowed') {
      const specials = parseSpecialClass(value);
      if (specials) hints.allowedSpecials = uniqueChars(`${hints.allowedSpecials ?? ''}${specials}`);
    }
  }

  return hints;
}

export function inferPasswordPolicyFromText(text: string): PasswordPolicyInput {
  const lower = text.toLowerCase();
  let hints: PasswordPolicyInput = {
    source: ['visible-text'],
    rawText: text,
  };

  const betweenMatch =
    lower.match(/between\s+(\d{1,3})\s+(?:and|to)\s+(\d{1,3})\s+(?:characters?|chars?)?/) ||
    lower.match(/(\d{1,3})\s*(?:-|to)\s*(\d{1,3})\s+(?:characters?|chars?)/);
  if (betweenMatch) {
    hints.minLength = Number(betweenMatch[1]);
    hints.maxLength = Number(betweenMatch[2]);
  }

  const minMatch =
    lower.match(/(?:at least|minimum|min(?:imum)? length(?: of)?|must be at least)\s*(\d{1,3})/) ||
    lower.match(/(\d{1,3})\s+(?:or more|characters?|chars?)\s+(?:minimum|min|or more)/) ||
    lower.match(/length\s+must\s+be\s+(?:>=|at least)\s*(\d{1,3})/);
  if (minMatch) hints.minLength = Number(minMatch[1]);

  const maxMatch =
    lower.match(/(?:maximum|max(?:imum)? length(?: of)?|up to|no more than|must be no more than)\s*(\d{1,3})/) ||
    lower.match(/(\d{1,3})\s+(?:characters?|chars?)\s+(?:maximum|max|or fewer)/) ||
    lower.match(/length\s+must\s+be\s+(?:<=|at most)\s*(\d{1,3})/);
  if (maxMatch) hints.maxLength = Number(maxMatch[1]);

  if (/\b(?:uppercase|upper-case|capital letter|upper case)\b/i.test(text)) hints.requireUppercase = true;
  if (/\b(?:lowercase|lower-case|lower case)\b/i.test(text)) hints.requireLowercase = true;
  if (/\b(?:number|digit|numeric|0-9)\b/i.test(text)) hints.requireDigit = true;
  if (/\b(?:special character|special chars?|symbols?|punctuation|non[- ]?alphanumeric)\b/i.test(text)) {
    hints.requireSpecial = true;
    hints.allowedSpecials = DEFAULT_SPECIALS;
  }

  const symbolListMatch = text.match(/(?:special characters?|symbols?|allowed characters?).{0,40}?([!@#$%^&*()_+\-=\[\]{}|;:'",.<>/?`~\\]{2,})/i);
  if (symbolListMatch) {
    hints.requireSpecial = true;
    hints.allowedSpecials = uniqueChars(symbolListMatch[1]);
  }

  if (/\b(?:no spaces|without spaces|must not contain spaces|cannot contain spaces|no whitespace|without whitespace)\b/i.test(text)) {
    hints.disallowedChars = uniqueChars(`${hints.disallowedChars ?? ''} \t\r\n`);
  }
  if (/\b(?:must not contain|cannot contain|should not contain).{0,20}\b(?:username|user name|email|e-mail)\b/i.test(text)) {
    hints.forbiddenSubstrings = ['username', 'email'];
  }

  return hints;
}

export function mergePasswordPolicies(...policies: PasswordPolicyInput[]): PasswordPolicy {
  const merged = policies.reduce<PasswordPolicyInput>((acc, policy) => mergePolicyInputs(acc, policy), {});
  return normalizePasswordPolicy(merged);
}
