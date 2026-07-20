import type {
  DeterministicPasswordMetadata,
  PasswordPolicy,
  PasswordPolicyState,
} from './passwordPolicy';
import { normalizePasswordPolicy } from './passwordPolicy';

export type WebsiteCredentialRecord = {
  version: 1;
  origin: string;
  websiteURL: string;
  uid: string;
  suid: string;
  username?: string;
  email?: string;
  passwordPolicy?: PasswordPolicy;
  passwordCounter: number;
  passwordMetadata?: DeterministicPasswordMetadata;
  createdAt: number;
  updatedAt: number;
};

export type SiteFieldOverride = {
  origin: string;
  usernameSelector?: string;
  currentPasswordSelector?: string;
  newPasswordSelector?: string;
  confirmPasswordSelector?: string;
};

/**
 * Describes how authentication material recovered from Cj is interpreted.
 * Legacy records predate this field and are always treated as derived.
 */
export type SiteCredentialMode = 'derived' | 'embedded-password';

export type SiteAccount = Partial<WebsiteCredentialRecord> & {
  accountId: string;
  label?: string;
  credentialMode?: SiteCredentialMode;
  encoderCounter?: number;
  storageProviderSuids?: Array<{ sp_id: number; suid: string }>;
};

type LegacySiteAccountRecord = {
  accountId?: string;
  label?: string;
  credentialMode?: SiteCredentialMode;
  createdAt?: number;
  updatedAt?: number;
  passwordPolicy?: PasswordPolicy;
  encoderCounter?: number;
  passwordCounter?: number;
  origin?: string;
  websiteURL?: string;
  uid?: string;
  suid?: string;
  username?: string;
  email?: string;
  passwordMetadata?: DeterministicPasswordMetadata;
  storageProviderSuids?: Array<{ sp_id: number; suid: string }>;
};

type RawSiteAccounts = Record<string, SiteAccount[] | LegacySiteAccountRecord | undefined>;
type SiteAccounts = Record<string, SiteAccount[]>;

const STORAGE_KEY = 'upspa_site_accounts';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeAccount(origin: string, account: LegacySiteAccountRecord): SiteAccount {
  const accountId = (account.accountId || account.username || account.email || '').trim();
  const createdAt = account.createdAt ?? nowSeconds();
  const passwordCounter =
    Number.isInteger(account.passwordCounter)
      ? account.passwordCounter
      : Number.isInteger(account.encoderCounter)
        ? account.encoderCounter
        : 0;
  const storageProviderSuids = account.storageProviderSuids ?? [];
  const suid = account.suid || storageProviderSuids[0]?.suid || '';

  return {
    version: 1,
    origin: account.origin || origin,
    websiteURL: account.websiteURL || origin,
    uid: account.uid || '',
    suid,
    username: account.username ?? accountId,
    email: account.email ?? (accountId.includes('@') ? accountId : undefined),
    accountId,
    label: account.label,
    credentialMode: account.credentialMode === 'embedded-password' ? 'embedded-password' : 'derived',
    createdAt,
    updatedAt: account.updatedAt ?? createdAt,
    passwordPolicy: account.passwordPolicy ? normalizePasswordPolicy(account.passwordPolicy) : undefined,
    passwordCounter,
    encoderCounter: passwordCounter,
    passwordMetadata: account.passwordMetadata,
    storageProviderSuids,
  };
}

function normalizeAccounts(raw: RawSiteAccounts): SiteAccounts {
  const out: SiteAccounts = {};
  for (const [origin, value] of Object.entries(raw)) {
    if (!value) continue;
    const accounts = Array.isArray(value) ? value : [value];
    const seen = new Set<string>();
    out[origin] = accounts
      .map((account) => normalizeAccount(origin, account))
      .filter((account) => {
        const accountId = account.accountId.trim();
        if (!accountId || seen.has(accountId)) return false;
        seen.add(accountId);
        account.accountId = accountId;
        return true;
      });
    if (out[origin].length === 0) delete out[origin];
  }
  return out;
}

async function getSiteAccounts(): Promise<SiteAccounts> {
  const out = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeAccounts(out[STORAGE_KEY] ?? {});
}

async function saveSiteAccounts(accounts: SiteAccounts): Promise<void> {
  for (const origin of Object.keys(accounts)) {
    if (accounts[origin].length === 0) delete accounts[origin];
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: accounts });
}

export async function getAccountsForOrigin(origin: string): Promise<SiteAccount[]> {
  const accounts = await getSiteAccounts();
  return accounts[origin] ?? [];
}

export async function listAccountsForOrigin(origin: string): Promise<SiteAccount[]> {
  return getAccountsForOrigin(origin);
}

export async function getAllSiteAccounts(): Promise<SiteAccount[]> {
  const accounts = await getSiteAccounts();
  return Object.values(accounts).flat();
}

export async function getAccountForOrigin(origin: string): Promise<string | undefined>;
export async function getAccountForOrigin(origin: string, accountId: string): Promise<SiteAccount | undefined>;
export async function getAccountForOrigin(
  origin: string,
  accountId?: string,
): Promise<string | SiteAccount | undefined> {
  const accounts = await getAccountsForOrigin(origin);
  if (accountId === undefined) return accounts[0]?.accountId;
  return accounts.find((account) => account.accountId === accountId.trim());
}

export async function upsertAccountForOrigin(origin: string, account: SiteAccount): Promise<void> {
  const cleanAccountId = account.accountId.trim();
  if (!origin) throw new Error('Origin is empty.');
  if (!cleanAccountId) throw new Error('Account id is empty.');

  const accounts = await getSiteAccounts();
  const originAccounts = accounts[origin] ?? [];
  const existing = originAccounts.find((item) => item.accountId === cleanAccountId);
  const now = nowSeconds();
  const incomingCounter =
    account.passwordCounter ?? account.encoderCounter ?? existing?.passwordCounter ?? existing?.encoderCounter ?? 0;
  const credentialMode = account.credentialMode ?? existing?.credentialMode ?? 'derived';
  const next: SiteAccount = {
    ...existing,
    ...account,
    version: 1,
    origin,
    websiteURL: account.websiteURL || existing?.websiteURL || origin,
    accountId: cleanAccountId,
    credentialMode,
    username: account.username ?? existing?.username ?? cleanAccountId,
    email: account.email ?? existing?.email ?? (cleanAccountId.includes('@') ? cleanAccountId : undefined),
    createdAt: existing?.createdAt ?? account.createdAt ?? now,
    updatedAt: now,
    uid: account.uid ?? existing?.uid ?? '',
    suid: account.suid ?? existing?.suid ?? account.storageProviderSuids?.[0]?.suid ?? '',
    storageProviderSuids: account.storageProviderSuids ?? existing?.storageProviderSuids ?? [],
    passwordPolicy: credentialMode === 'derived'
      ? account.passwordPolicy
        ? normalizePasswordPolicy(account.passwordPolicy)
        : existing?.passwordPolicy
      : undefined,
    passwordCounter: credentialMode === 'derived' ? incomingCounter : 0,
    encoderCounter: credentialMode === 'derived' ? incomingCounter : 0,
    passwordMetadata: credentialMode === 'derived'
      ? account.passwordMetadata ?? existing?.passwordMetadata
      : undefined,
  };

  if (existing) {
    Object.assign(existing, next);
  } else {
    originAccounts.push(next);
  }
  accounts[origin] = originAccounts;
  await saveSiteAccounts(accounts);
}

export async function setAccountForOrigin(origin: string, accountId: string): Promise<void> {
  const cleanAccountId = accountId.trim();
  if (!origin) throw new Error('Origin is empty.');
  if (!cleanAccountId) throw new Error('Account id is empty.');

  await upsertAccountForOrigin(origin, {
    accountId: cleanAccountId,
    createdAt: nowSeconds(),
  });
}

export async function updateAccountForOrigin(
  origin: string,
  previousAccountId: string,
  nextAccountId: string,
): Promise<void> {
  const cleanPrevious = previousAccountId.trim();
  const cleanNext = nextAccountId.trim();
  if (!origin) throw new Error('Origin is empty.');
  if (!cleanPrevious) throw new Error('Previous account id is empty.');
  if (!cleanNext) throw new Error('New account id is empty.');

  const accounts = await getSiteAccounts();
  const originAccounts = accounts[origin] ?? [];
  const existing = originAccounts.find((account) => account.accountId === cleanPrevious);
  const duplicate = originAccounts.some(
    (account) => account.accountId === cleanNext && account.accountId !== cleanPrevious,
  );
  if (duplicate) throw new Error('That account id already exists for this origin.');
  if (existing) {
    existing.accountId = cleanNext;
    existing.username = existing.username === cleanPrevious ? cleanNext : existing.username;
    existing.email = existing.email === cleanPrevious ? cleanNext : existing.email;
    existing.updatedAt = nowSeconds();
    accounts[origin] = originAccounts;
  } else {
    accounts[origin] = [
      ...originAccounts,
      {
        accountId: cleanNext,
        username: cleanNext,
        origin,
        websiteURL: origin,
        createdAt: nowSeconds(),
        updatedAt: nowSeconds(),
        passwordCounter: 0,
        encoderCounter: 0,
      },
    ];
  }
  await saveSiteAccounts(accounts);
}

export async function updatePasswordPolicyForAccount(
  origin: string,
  accountId: string,
  state: PasswordPolicyState,
): Promise<void> {
  const cleanAccountId = accountId.trim();
  if (!cleanAccountId) throw new Error('Account id is empty.');
  const existing = await getAccountForOrigin(origin, cleanAccountId);
  await upsertAccountForOrigin(origin, {
    ...(existing ?? {
      accountId: cleanAccountId,
      createdAt: nowSeconds(),
    }),
    passwordPolicy: normalizePasswordPolicy(state.policy),
    passwordCounter: state.encoderCounter,
    encoderCounter: state.encoderCounter,
    passwordMetadata: state.passwordMetadata ?? existing?.passwordMetadata,
  });
}

export async function removeAccountForOrigin(origin: string, accountId?: string): Promise<void> {
  if (!origin) throw new Error('Origin is empty.');
  const accounts = await getSiteAccounts();
  if (!accountId) {
    delete accounts[origin];
    await saveSiteAccounts(accounts);
    return;
  }

  accounts[origin] = (accounts[origin] ?? []).filter((account) => account.accountId !== accountId);
  await saveSiteAccounts(accounts);
}
