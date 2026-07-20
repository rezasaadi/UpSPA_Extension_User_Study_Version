export type Base64Url = string;
export interface CtBlobB64 {
  nonce: Base64Url;
  ct: Base64Url;
  tag: Base64Url;
}
export interface SetupShare {
  sp_id: number;
  k_i: Base64Url;
}
export interface SetupSpPayload {
  sp_id: number;
  uid: Base64Url;
  sig_pk: Base64Url;
  cid: CtBlobB64;
  k_i: Base64Url;
}
export interface SetupResult {
  sig_pk: Base64Url;
  cid: CtBlobB64;
  shares: SetupShare[];
  sp_payloads: SetupSpPayload[];
}
export interface ToprfBegin {
  r: Base64Url;
  blinded: Base64Url;
}
export interface ToprfPartial {
  id: number;
  y: Base64Url;
}
export interface RegistrationSpOut {
  sp_id: number;
  suid: Base64Url;
  cj: CtBlobB64;
}
export interface RegistrationOut {
  per_sp: RegistrationSpOut[];
  to_ls: {
    uid: Base64Url;
    vinfo: Base64Url;
  };
}
export type CredentialKind = 'derived' | 'embedded_password';
export interface MigrationOut {
  credential_kind: 'embedded_password';
  per_sp: RegistrationSpOut[];
}
export interface AuthPrepareOut {
  k0: Base64Url;
  per_sp: Array<{ sp_id: number; suid: Base64Url }>;
}
export type AuthFinishOut =
  | {
      credential_kind: 'derived';
      vinfo_prime: Base64Url;
      best_ctr: number;
    }
  | {
      credential_kind: 'embedded_password';
      website_password: string;
      best_ctr: number;
    };
export interface SecretUpdatePrepareOut {
  k0: Base64Url;
  per_sp: Array<{ sp_id: number; suid: Base64Url }>;
}
export interface SecretUpdateFinishOut {
  credential_kind: 'embedded_password';
  previous_credential_kind: CredentialKind;
  cj_new: CtBlobB64;
  old_ctr: number;
  new_ctr: number;
}
export interface PasswordUpdateOut {
  cid_new: CtBlobB64;
  per_sp: Array<{ sp_id: number; sig: Base64Url; k_i_new: Base64Url }>;
}
export interface StorageProviderDescriptor {
  id: number;
  baseUrl: string;
}
export interface UpspaClientConfig {
  uid: string;
  sps: StorageProviderDescriptor[];
  threshold: number;
}
