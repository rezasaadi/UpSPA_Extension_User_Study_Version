import type { UpspaConfig } from './config';
import type { StorageMode } from './config';
import type { PasswordPolicy } from './passwordPolicy';
import type { CtBlobB64 } from 'upspa-js';
import type {
  CredentialContinuationInput,
  CredentialContinuation,
  CredentialContinuationExpectedStage,
} from './credentialContinuation';
import type { DetectedPageContext } from './pageContext';
export type UpspaMode = 'login' | 'register' | 'change-password';
export type ContentFillRequest =
  | {
      type: 'UPSPA_FILL_IDENTITY';
      payload: {
        siteId?: string;
        uid?: string;
        accountId: string;
        overwrite?: boolean;
      };
    }
  | {
      type: 'UPSPA_FILL_REGISTER';
      payload: {
        siteId?: string;
        uid?: string;
        accountId: string;
        passwordForLs: string;
        flowId?: string;
        origin?: string;
        confirmationNonce?: string;
        overwrite?: boolean;
      };
    }
  | {
      type: 'UPSPA_FILL_LOGIN';
      payload: {
        siteId?: string;
        uid?: string;
        accountId: string;
        passwordForLs: string;
        overwrite?: boolean;
      };
    }
  | {
      type: 'UPSPA_FILL_PASSWORD_CHANGE';
      payload: {
        siteId?: string;
        oldPasswordForLs: string;
        newPasswordForLs: string;
        overwrite?: boolean;
      };
    }
  | { type: 'UPSPA_EXTRACT_PASSWORD_POLICY' }
  | { type: 'UPSPA_CAPTURE_IDENTITY_FIELDS' }
  | { type: 'UPSPA_CLEAR_IN_PAGE_CONTINUATION' };
export type ContentFillResponse =
  | {
      ok: true;
      filled: {
        username: boolean;
        passwords: number;
      };
      captured?: {
        uid?: string;
        accountId?: string;
        username?: string;
        email?: string;
      };
    }
  | {
      ok: false;
      error: string;
    };
export type ContentIdentityResponse =
  | {
      ok: true;
      captured: {
        uid?: string;
        accountId?: string;
        username?: string;
        email?: string;
      };
    }
  | {
      ok: false;
      error: string;
    };
export type PasswordPolicyExtractionResponse =
  | {
      ok: true;
      policyHints: Partial<PasswordPolicy>;
      evidence: string[];
    }
  | {
      ok: false;
      error: string;
    };
export type BgRequest =
  | { type: 'UPSRA_GET_CONFIG' }
  | { type: 'UPSRA_SET_CONFIG'; cfg: UpspaConfig }
  | {
      type: 'UPSRA_SETUP_AND_PROVISION';
      uid: string;
      password: string;
      threshold: number;
      sps: Array<{ id: number; baseUrl: string }>;
      storageMode?: StorageMode;
    }
  | { type: 'UPSRA_REGISTER'; lsj: string; password: string }
  | { type: 'UPSRA_AUTH'; lsj: string; password: string }
  | { type: 'UPSRA_SECRET_UPDATE_PREP'; lsj: string; password: string }
  | { type: 'UPSRA_SECRET_UPDATE_COMMIT'; suids: Array<{ sp_id: number; suid: string }>; cj_new: CtBlobB64 }
  | { type: 'UPSRA_PASSWORD_UPDATE'; old_password: string; new_password: string; timestamp: number }
  | {
      type: 'UPSPA_REGISTRATION_FORM_SUBMITTED';
      flowId: string;
      origin: string;
    }
  | {
      type: 'UPSPA_OPEN_POPUP_REQUESTED';
      url: string;
      origin: string;
      siteId?: string;
    }
  | { type: 'UPSPA_SAVE_CREDENTIAL_CONTINUATION'; continuation: CredentialContinuationInput }
  | { type: 'UPSPA_GET_CREDENTIAL_CONTINUATION'; siteId: string; tabId?: number }
  | { type: 'UPSPA_CLEAR_CREDENTIAL_CONTINUATION'; siteId: string; tabId?: number; flowId?: string }
  | {
      type: 'UPSPA_ADVANCE_CREDENTIAL_CONTINUATION';
      siteId: string;
      tabId?: number;
      flowId?: string;
      expectedStage: CredentialContinuationExpectedStage;
    }
  | { type: 'UPSPA_GET_PAGE_CONTEXT'; siteId: string; tabId: number };
export type BgResponse =
  | { ok: true; cfg?: UpspaConfig }
  | { ok: true; vinfo_b64: string }
  | { ok: true; vinfo_prime_b64: string }
  | { ok: true; secret_update: { vinfo_prime_b64: string; vinfo_new_b64: string; cj_new: CtBlobB64; suids: Array<{ sp_id: number; suid: string }>; old_ctr: number; new_ctr: number } }
  | { ok: true; password_update: { cid_new: CtBlobB64 } }
  | { ok: true; continuation?: CredentialContinuation }
  | { ok: true; pageContext?: DetectedPageContext }
  | { ok: true; opened?: 'side-panel' | 'action-popup' | 'embedded-panel' }
  | { ok: false; error: string };
