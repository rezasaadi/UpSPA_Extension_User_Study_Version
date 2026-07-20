import type { PasswordPolicy } from '../passwordPolicy';
import type { SitePageKind } from '../pageClassifier';

export type ExtensionEventSource = 'popup' | 'content' | 'background' | 'local-sp' | 'system';
export type PrototypeFormType = 'login' | 'register' | 'password-update' | 'unknown';
export type PrototypeOperation =
  | 'setup'
  | 'registration'
  | 'authentication'
  | 'secret-update'
  | 'password-update'
  | 'policy-load'
  | 'autofill';
export type PrototypeScreen =
  | 'setup'
  | 'sign-in'
  | 'create-account'
  | 'save-login'
  | 'saved-accounts'
  | 'password-settings'
  | 'success'
  | 'unsupported'
  | 'setup-required'
  | 'dashboard'
  | 'account-picker'
  | 'add-account-choice'
  | 'master-auth'
  | 'site-account-details'
  | 'site-password-settings'
  | 'waiting-confirmation'
  | 'operation-success'
  | 'master-password-current'
  | 'master-password-new'
  | 'master-password-checklist'
  | 'master-password-success'
  | 'error';

export type FieldDetectionSummary = {
  username: boolean;
  password: boolean;
  passwordCount: number;
  currentPassword: boolean;
  newPassword: boolean;
  submit: boolean;
};

type BaseEvent = {
  source: ExtensionEventSource;
  timestamp: number;
};

export type ExtensionEvent =
  | (BaseEvent & {
      type: 'PAGE_CLASSIFIED';
      url: string;
      origin: string;
      siteId?: string;
      pageKind: SitePageKind;
    })
  | (BaseEvent & {
      type: 'SUPPORTED_SITE_DETECTED';
      url: string;
      origin: string;
      host: string;
      siteId: string;
      label: string;
    })
  | (BaseEvent & {
      type: 'UNSUPPORTED_SITE_DETECTED';
      url: string;
      origin: string;
      host: string;
      reason: string;
    })
  | (BaseEvent & {
      type: 'FORM_DETECTED';
      url: string;
      origin: string;
      siteId?: string;
      formType: PrototypeFormType;
      fields: FieldDetectionSummary;
    })
  | (BaseEvent & {
      type: 'FIELD_FOCUSED';
      url: string;
      origin: string;
      siteId?: string;
      fieldType: 'username' | 'password' | 'unknown';
    })
  | (BaseEvent & {
      type: 'POLICY_LOADED';
      siteId: string;
      label: string;
      policy: PasswordPolicy;
      policyNote: string;
    })
  | (BaseEvent & {
      type: 'SCREEN_CHANGED';
      screen: PrototypeScreen;
      reason?: string;
    })
  | (BaseEvent & {
      type: 'USER_REQUESTED_REGISTRATION';
      origin: string;
      accountId: string;
    })
  | (BaseEvent & {
      type: 'USER_REQUESTED_AUTHENTICATION';
      origin: string;
      accountId: string;
    })
  | (BaseEvent & {
      type: 'USER_REQUESTED_SECRET_UPDATE';
      origin: string;
      accountId: string;
    })
  | (BaseEvent & {
      type: 'USER_REQUESTED_PASSWORD_UPDATE';
    })
  | (BaseEvent & { type: 'ACCOUNT_SELECTED'; siteId: string; accountId: string; flowId?: string })
  | (BaseEvent & { type: 'ADD_ANOTHER_ACCOUNT_SELECTED'; siteId: string; flowId?: string })
  | (BaseEvent & { type: 'USER_REQUESTED_SETUP' })
  | (BaseEvent & { type: 'USER_REQUESTED_SITE_SIGNUP'; siteId: string })
  | (BaseEvent & { type: 'USER_REQUESTED_SITE_SIGNIN'; siteId: string; accountId?: string })
  | (BaseEvent & { type: 'USER_REQUESTED_ADD_EXISTING_ACCOUNT'; siteId: string })
  | (BaseEvent & { type: 'USER_REQUESTED_WEBSITE_RECORD_REFRESH'; siteId: string; accountId?: string })
  | (BaseEvent & { type: 'USER_REQUESTED_MASTER_PASSWORD_UPDATE' })
  | (BaseEvent & { type: 'USER_CONFIRMED_ACCOUNT_CREATED'; flowId: string })
  | (BaseEvent & { type: 'USER_CONFIRMED_WEBSITE_RECORD_REFRESHED'; flowId: string })
  | (BaseEvent & { type: 'FLOW_RESTORED'; flowId: string; kind: string; stage: string })
  | (BaseEvent & { type: 'FLOW_CANCELLED'; flowId?: string; reason?: string })
  | (BaseEvent & {
      type: 'OPERATION_STARTED';
      operation: PrototypeOperation;
      accountId?: string;
      siteId?: string;
    })
  | (BaseEvent & {
      type: 'OPERATION_SUCCESS';
      operation: PrototypeOperation;
      message: string;
      accountId?: string;
      siteId?: string;
    })
  | (BaseEvent & {
      type: 'OPERATION_FAILED';
      operation: PrototypeOperation;
      error: string;
      accountId?: string;
      siteId?: string;
    })
  | (BaseEvent & {
      type: 'FILL_ATTEMPTED';
      formType: PrototypeFormType;
      usernameFilled: boolean;
      passwordFieldsFilled: number;
    });

export type ExtensionEventType = ExtensionEvent['type'];
export type ExtensionEventMap = {
  [K in ExtensionEventType]: Extract<ExtensionEvent, { type: K }>;
};

export type ExtensionEventInput = ExtensionEvent extends infer E
  ? E extends ExtensionEvent
    ? Omit<E, 'timestamp'> & { timestamp?: number }
    : never
  : never;

export function makeExtensionEvent(event: ExtensionEventInput): ExtensionEvent {
  return {
    timestamp: Date.now(),
    ...event,
  } as ExtensionEvent;
}
