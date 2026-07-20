import { normalizePasswordPolicy, type PasswordPolicy } from './passwordPolicy';

export type PrototypeSiteDifficulty = 'easy' | 'medium' | 'hard';
export type PrototypePolicySource = 'official' | 'signup-page-observed' | 'conservative-prototype';

export type SupportedPrototypeSite = {
  id: string;
  label: string;
  hostnames: string[];
  /** Stable origin used when deriving or looking up this provider's credentials. */
  credentialOrigin: string;
  signupUrl: string;
  loginUrl: string;
  passwordChangeUrl?: string;
  signupUrls?: string[];
  loginUrls?: string[];
  passwordChangeUrls?: string[];
  sharedAuthPage?: boolean;
  credentialMode?: 'password' | 'password-or-federated' | 'passwordless';
  multiStep: {
    login: true;
    signup: true;
    passwordChange: true;
  };
  difficulty: PrototypeSiteDifficulty;
  policySource: PrototypePolicySource;
  policyNote: string;
  policy: PasswordPolicy;
  fieldHints?: {
    username?: string[];
    registrationUsername?: string[];
    email?: string[];
    password?: string[];
    newPassword?: string[];
    oldPassword?: string[];
    submit?: string[];
  };
};

type SupportedPrototypeSiteDefinition = Omit<
  SupportedPrototypeSite,
  'credentialOrigin' | 'multiStep'
> & {
  credentialOrigin?: string;
  multiStep?: SupportedPrototypeSite['multiStep'];
};

const COMMON_SYMBOLS = '!@#$%^&*';

// Conservative relaxed policy for the user-testing version.
// It intentionally avoids symbols by default because several real websites are inconsistent
// about which special characters they accept. A 20-character mixed-case alphanumeric
// password usually passes common min-length and character-class requirements while avoiding
// max-length problems on sites that cap passwords at 20 characters.
export const relaxed20Policy: PasswordPolicy = normalizePasswordPolicy({
  minLen: 16,
  maxLen: 20,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: false,
  allowedSymbols: COMMON_SYMBOLS,
  forbidWhitespace: true,
  forbiddenSubstrings: [],
  source: ['domain-quirk'],
});

export const githubPolicy: PasswordPolicy = normalizePasswordPolicy({
  minLen: 15,
  maxLen: 20,
  requireUpper: false,
  requireLower: false,
  requireDigit: false,
  requireSymbol: false,
  allowedSymbols: COMMON_SYMBOLS,
  forbidWhitespace: true,
  forbiddenSubstrings: [],
  source: ['domain-quirk'],
});

export const googlePolicy: PasswordPolicy = normalizePasswordPolicy({
  minLen: 12,
  maxLen: 20,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: false,
  allowedSymbols: COMMON_SYMBOLS,
  forbidWhitespace: true,
  forbiddenSubstrings: [],
  source: ['domain-quirk'],
});

export const applePolicy: PasswordPolicy = normalizePasswordPolicy({
  minLen: 8,
  maxLen: 20,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: false,
  allowedSymbols: COMMON_SYMBOLS,
  forbidWhitespace: true,
  forbiddenSubstrings: [],
  source: ['domain-quirk'],
});

const SUPPORTED_PROTOTYPE_SITE_DEFINITIONS: SupportedPrototypeSiteDefinition[] = [
  {
    id: 'google',
    label: 'Google / Gmail',
    hostnames: ['accounts.google.com', 'google.com', 'gmail.com'],
    signupUrl: 'https://accounts.google.com/signup',
    loginUrl: 'https://accounts.google.com/signin',
    passwordChangeUrl: 'https://myaccount.google.com/signinoptions/password',
    difficulty: 'hard',
    policySource: 'official',
    policyNote: 'Google allows ASCII letters/numbers/symbols, rejects weak/reused passwords and leading/trailing blank spaces; registry uses 20-char mixed alphanumeric.',
    policy: googlePolicy,
    fieldHints: {
      username: [
        'input[name="identifier"][type="email"]',
        'input[autocomplete~="username"][type="email"]',
      ],
      password: [
        'input[name="Passwd"][type="password"]',
        'input[autocomplete="current-password"][type="password"]',
      ],
      newPassword: [
        'input[name="Passwd"][type="password"]',
        'input[name="password"][autocomplete="new-password"][type="password"]',
      ],
    },
  },
  {
    id: 'microsoft',
    label: 'Microsoft / Outlook',
    hostnames: ['login.live.com', 'login.microsoftonline.com', 'signup.live.com', 'account.microsoft.com', 'outlook.live.com'],
    signupUrl: 'https://signup.live.com/signup',
    loginUrl: 'https://login.live.com/',
    signupUrls: ['https://signup.live.com/'],
    loginUrls: ['https://login.microsoftonline.com/*'],
    passwordChangeUrl: 'https://account.microsoft.com/security',
    difficulty: 'hard',
    policySource: 'conservative-prototype',
    policyNote: 'Microsoft account pages are dynamic/passwordless-first; use relaxed20Policy and validate manually.',
    policy: relaxed20Policy,
    fieldHints: {
      username: [
        'input#usernameEntry',
        'input[name="email"]',
      ],
      email: ['input[name="email"]'],
    },
  },
  {
    id: 'apple',
    label: 'Apple Account / iCloud',
    hostnames: ['appleid.apple.com', 'account.apple.com', 'idmsa.apple.com', 'icloud.com'],
    signupUrl: 'https://account.apple.com/account',
    loginUrl: 'https://account.apple.com/sign-in',
    loginUrls: ['https://idmsa.apple.com/appleauth/auth/signin'],
    passwordChangeUrl: 'https://account.apple.com/account/manage',
    difficulty: 'hard',
    policySource: 'official',
    policyNote: 'Apple Account traditionally requires at least 8 chars with uppercase, lowercase, and number; registry uses 20-char compatible candidate.',
    policy: applePolicy,
    fieldHints: {
      // The sign-in widget is hosted in an idmsa.apple.com iframe. Content
      // scripts run in that frame and can use these audited IDs directly.
      username: ['input#account_name_text_field[autocomplete~="username"]'],
      email: ['input[name="appleId"][type="email"]'],
      password: ['input#password_text_field[type="password"]'],
      newPassword: [
        'input[name="password"][autocomplete="new-password"][type="password"]',
        'input[name="confirmPassword"][type="password"]',
      ],
    },
  },
  {
    id: 'facebook',
    label: 'Facebook',
    hostnames: ['facebook.com', 'www.facebook.com'],
    signupUrl: 'https://www.facebook.com/r.php',
    loginUrl: 'https://www.facebook.com/login/',
    passwordChangeUrl: 'https://www.facebook.com/settings?tab=security',
    difficulty: 'hard',
    policySource: 'conservative-prototype',
    policyNote: 'Meta pages often block automated access; use relaxed20Policy and validate in manual user testing.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input[name="email"]'],
      email: ['input[name="email"]'],
      password: ['input[name="pass"][type="password"]'],
    },
  },
  {
    id: 'instagram',
    label: 'Instagram',
    hostnames: ['instagram.com', 'www.instagram.com'],
    signupUrl: 'https://www.instagram.com/accounts/emailsignup/',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    passwordChangeUrl: 'https://www.instagram.com/accounts/password/change/',
    difficulty: 'hard',
    policySource: 'conservative-prototype',
    policyNote: 'Meta/Instagram signup is JS-heavy; use relaxed20Policy and validate manually.',
    policy: relaxed20Policy,
    fieldHints: {
      // Instagram's sign-up username is intentionally type="search". Keep this
      // selector exact so it does not weaken the global search-field guard.
      username: [
        'input[type="search"][placeholder="Username"]',
        'input[autocomplete~="username"]',
      ],
      registrationUsername: ['input[type="search"][placeholder="Username"]'],
      email: ['input[name="emailOrPhone"]'],
      password: ['input[name="pass"][type="password"]'],
    },
  },
  {
    id: 'x',
    label: 'X / Twitter',
    hostnames: ['x.com', 'twitter.com'],
    signupUrl: 'https://x.com/i/flow/signup',
    loginUrl: 'https://x.com/i/flow/login',
    signupUrls: ['https://x.com/signup', 'https://twitter.com/signup', 'https://twitter.com/i/flow/signup'],
    loginUrls: ['https://x.com/login', 'https://twitter.com/login', 'https://twitter.com/i/flow/login'],
    passwordChangeUrl: 'https://x.com/settings/password',
    difficulty: 'hard',
    policySource: 'conservative-prototype',
    policyNote: 'X signup is anti-automation and multi-step; use relaxed20Policy and validate manually.',
    policy: relaxed20Policy,
    fieldHints: {
      // Audited on the current staged signup screen. Duplicate hidden DOM
      // copies are harmless because content filtering keeps the visible one.
      username: [
        'input#jf-input-username_or_email[name="username_or_email"][autocomplete~="username"]',
      ],
    },
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    hostnames: ['linkedin.com', 'www.linkedin.com'],
    signupUrl: 'https://www.linkedin.com/signup',
    loginUrl: 'https://www.linkedin.com/login',
    passwordChangeUrl: 'https://www.linkedin.com/psettings/change-password',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy; LinkedIn may require additional verification.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input[autocomplete~="username"]:not([type="search"])'],
      password: ['input[autocomplete="current-password"][type="password"]'],
    },
  },
  {
    id: 'github',
    label: 'GitHub',
    hostnames: ['github.com'],
    signupUrl: 'https://github.com/signup',
    loginUrl: 'https://github.com/login',
    passwordChangeUrl: 'https://github.com/settings/security',
    difficulty: 'medium',
    policySource: 'official',
    policyNote: 'Official policy: 15+ chars, or 8+ chars with a number and lowercase letter. Registry chooses 15-20 chars.',
    policy: githubPolicy,
    fieldHints: {
      username: [
        'input#login_field[name="login"]',
        'input[name="login"][autocomplete~="username"]',
      ],
      registrationUsername: [
        'input#login[name="user[login]"]',
        'input[name="user[login]"][autocomplete~="username"]',
      ],
      email: [
        'input#email[name="user[email]"][type="email"]',
        'input[name="user[email]"][autocomplete~="email"]',
      ],
      password: [
        'input[name="user[password]"][type="password"]',
        'input[name="password"][autocomplete="current-password"][type="password"]',
      ],
    },
  },
  {
    id: 'gitlab',
    label: 'GitLab',
    hostnames: ['gitlab.com'],
    signupUrl: 'https://gitlab.com/users/sign_up',
    loginUrl: 'https://gitlab.com/users/sign_in',
    passwordChangeUrl: 'https://gitlab.com/-/profile/password/edit',
    difficulty: 'medium',
    policySource: 'signup-page-observed',
    policyNote: 'Signup page exposes a password field but not stable text policy in static HTML; use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      // Stable GitLab Rails field IDs. Cloudflare blocked the current audit, so
      // keep these fallbacks narrow until they can be reconfirmed in-browser.
      username: ['input#user_login[name="user[login]"]'],
      registrationUsername: ['input#new_user_username[name="new_user[username]"]'],
      email: ['input#new_user_email[name="new_user[email]"][type="email"]'],
      password: ['input#user_password[name="user[password]"][type="password"]'],
      newPassword: ['input#new_user_password[name="new_user[password]"][type="password"]'],
    },
  },
  {
    id: 'bitbucket',
    label: 'Bitbucket / Atlassian',
    hostnames: ['bitbucket.org', 'id.atlassian.com', 'atlassian.com'],
    credentialOrigin: 'https://id.atlassian.com',
    signupUrl: 'https://www.atlassian.com/try/cloud/signup?bundle=bitbucket',
    loginUrl: 'https://bitbucket.org/account/signin/',
    passwordChangeUrl: 'https://id.atlassian.com/manage-profile/security',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Atlassian account flow is dynamic; use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      // Atlassian rendered no inspectable field during the current audit. The
      // exact legacy IDs are retained as conservative fallbacks, not claimed
      // as a current live contract.
      username: ['input#username[name="username"]'],
      email: ['input#username[name="username"]'],
      password: ['input#password[name="password"][type="password"]'],
    },
  },
  {
    id: 'stackoverflow',
    label: 'Stack Overflow',
    hostnames: ['stackoverflow.com', 'stackexchange.com'],
    signupUrl: 'https://stackoverflow.com/users/signup',
    loginUrl: 'https://stackoverflow.com/users/login',
    passwordChangeUrl: 'https://stackoverflow.com/users/account-info',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'May block automated scraping; use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input#email'],
      email: ['input#email'],
      password: ['input#password[type="password"]'],
      newPassword: ['input#password[type="password"][autocomplete="new-password"]'],
    },
  },
  {
    id: 'reddit',
    label: 'Reddit',
    hostnames: ['reddit.com', 'www.reddit.com'],
    signupUrl: 'https://www.reddit.com/register/',
    loginUrl: 'https://www.reddit.com/login/',
    passwordChangeUrl: 'https://www.reddit.com/settings/account',
    difficulty: 'medium',
    policySource: 'signup-page-observed',
    policyNote: 'Static signup page exposes username/password step but no explicit policy text; use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      // Current accessibility exposes the staged account field, but the input
      // is not queryable in the top document. These strict semantic selectors
      // are safe fallbacks for an open-shadow/input implementation.
      username: ['input[name="username"][autocomplete~="username"]'],
      registrationUsername: ['input[name="username"][autocomplete~="username"]'],
      email: ['input[name="email"][autocomplete~="email"]'],
      password: ['input[name="password"][autocomplete="current-password"][type="password"]'],
      newPassword: ['input[name="password"][autocomplete="new-password"][type="password"]'],
    },
  },
  {
    id: 'discord',
    label: 'Discord',
    hostnames: ['discord.com'],
    signupUrl: 'https://discord.com/register',
    loginUrl: 'https://discord.com/login',
    passwordChangeUrl: 'https://discord.com/channels/@me',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'JS app; use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input[name="email"][autocomplete~="username"]'],
      registrationUsername: ['input[name="username"][autocomplete~="username"]'],
      email: ['input[name="email"][type="email"]'],
      password: ['input[name="password"][autocomplete="current-password"][type="password"]'],
      newPassword: ['input[name="password"][autocomplete="new-password"][type="password"]'],
    },
  },
  {
    id: 'slack',
    label: 'Slack',
    hostnames: ['slack.com'],
    signupUrl: 'https://slack.com/get-started',
    loginUrl: 'https://slack.com/signin',
    credentialMode: 'password-or-federated',
    passwordChangeUrl: 'https://slack.com/account/settings',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Public sign-in uses an email confirmation code, Apple, or Google; workspace-specific accounts can still use passwords, so password autofill is conditional.',
    policy: relaxed20Policy,
    fieldHints: {
      username: [
        'input#signup_email',
        'input#creator_signup_email',
      ],
      email: [
        'input#signup_email',
        'input#creator_signup_email',
      ],
    },
  },
  {
    id: 'zoom',
    label: 'Zoom',
    hostnames: ['zoom.us'],
    signupUrl: 'https://zoom.us/signup',
    loginUrl: 'https://zoom.us/signin',
    passwordChangeUrl: 'https://zoom.us/profile',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy; Zoom may enforce extra anti-reuse/security checks.',
    policy: relaxed20Policy,
    fieldHints: {
      // Audited login identifier. Deliberately excludes signup #year, which is
      // a date-of-birth pre-stage rather than an account identifier.
      username: ['input#email[name="account"]'],
    },
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    hostnames: ['dropbox.com', 'www.dropbox.com'],
    signupUrl: 'https://www.dropbox.com/register',
    loginUrl: 'https://www.dropbox.com/login',
    passwordChangeUrl: 'https://www.dropbox.com/account/security',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input[name="susi_email"]'],
      email: ['input[name="susi_email"]'],
      password: ['input[name="login_password"][type="password"]'],
      newPassword: ['input[name="susi_password"][type="password"]'],
    },
  },
  {
    id: 'box',
    label: 'Box',
    hostnames: ['box.com', 'account.box.com'],
    signupUrl: 'https://account.box.com/signup/n/personal?tc=annual',
    loginUrl: 'https://account.box.com/login',
    signupUrls: ['https://account.box.com/signup/personal'],
    passwordChangeUrl: 'https://account.box.com/account',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: [
        'input#login-email',
        'input[name="email"][type="text"]',
      ],
      email: ['input[name="email"][type="text"]'],
      password: ['input[name="password"][type="password"]'],
      newPassword: ['input[name="password"][type="password"]'],
    },
  },
  {
    id: 'notion',
    label: 'Notion',
    hostnames: ['notion.so', 'www.notion.so', 'app.notion.com'],
    signupUrl: 'https://app.notion.com/signup',
    loginUrl: 'https://app.notion.com/login',
    signupUrls: ['https://www.notion.so/signup'],
    loginUrls: ['https://www.notion.so/login'],
    passwordChangeUrl: 'https://app.notion.com/my-account',
    passwordChangeUrls: ['https://www.notion.so/my-account'],
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Notion often uses magic-link/SSO; include for auth UI testing, use relaxed20Policy when password is available.',
    policy: relaxed20Policy,
    fieldHints: {
      username: [
        'input[autocomplete~="username"]:not([type="search"])',
        'input[autocomplete~="email"][type="email"]',
      ],
      email: ['input[autocomplete~="email"][type="email"]'],
      password: ['input[autocomplete="current-password"][type="password"]'],
      newPassword: ['input[autocomplete="new-password"][type="password"]'],
    },
  },
  {
    id: 'figma',
    label: 'Figma',
    hostnames: ['figma.com', 'www.figma.com'],
    signupUrl: 'https://www.figma.com/signup',
    loginUrl: 'https://www.figma.com/login',
    passwordChangeUrl: 'https://www.figma.com/settings',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input#email'],
      email: ['input#email'],
      password: ['input#current-password[type="password"]'],
    },
  },
  {
    id: 'canva',
    label: 'Canva',
    hostnames: ['canva.com', 'www.canva.com'],
    signupUrl: 'https://www.canva.com/signup/',
    loginUrl: 'https://www.canva.com/login/',
    passwordChangeUrl: 'https://www.canva.com/settings/account',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      // The current Canva page stopped at an auth-method shell. Restrict the
      // fallback to semantic email/password autocomplete contracts.
      username: ['input[autocomplete~="email"][type="email"]'],
      email: ['input[autocomplete~="email"][type="email"]'],
      password: ['input[autocomplete="current-password"][type="password"]'],
      newPassword: ['input[autocomplete="new-password"][type="password"]'],
    },
  },
  {
    id: 'adobe',
    label: 'Adobe',
    hostnames: ['adobe.com', 'auth.services.adobe.com'],
    signupUrl: 'https://auth.services.adobe.com/en_US/deeplink.html#/register',
    loginUrl: 'https://auth.services.adobe.com/en_US/deeplink.html#/signin',
    signupUrls: ['https://account.adobe.com/'],
    loginUrls: ['https://account.adobe.com/'],
    sharedAuthPage: true,
    passwordChangeUrl: 'https://account.adobe.com/security',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy; validate manually because Adobe may reject breached/weak candidates.',
    policy: relaxed20Policy,
    fieldHints: {
      username: [
        'input#EmailPage-EmailField[name="username"][autocomplete~="email"]',
      ],
      email: [
        'input#EmailPage-EmailField[name="username"][autocomplete~="email"]',
      ],
      password: ['input#PasswordPage-PasswordField[type="password"]'],
    },
  },
  {
    id: 'spotify',
    label: 'Spotify',
    hostnames: ['spotify.com', 'www.spotify.com', 'accounts.spotify.com'],
    signupUrl: 'https://www.spotify.com/signup',
    loginUrl: 'https://accounts.spotify.com/login',
    signupUrls: ['https://www.spotify.com/*/signup'],
    loginUrls: ['https://accounts.spotify.com/*/login'],
    passwordChangeUrl: 'https://www.spotify.com/account/change-password/',
    difficulty: 'easy',
    policySource: 'signup-page-observed',
    policyNote: 'Signup is multi-step; static page starts with email and later password. Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input#username'],
    },
  },
  {
    id: 'netflix',
    label: 'Netflix',
    hostnames: ['netflix.com', 'www.netflix.com'],
    signupUrl: 'https://www.netflix.com/signup',
    loginUrl: 'https://www.netflix.com/login',
    passwordChangeUrl: 'https://www.netflix.com/password',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Payment-oriented onboarding; use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input[name="userLoginId"]'],
      password: ['input[name="password"][type="password"]'],
    },
  },
  {
    id: 'amazon',
    label: 'Amazon',
    hostnames: ['amazon.com', 'www.amazon.com'],
    signupUrl: 'https://www.amazon.com/ap/register?openid.return_to=https%3A%2F%2Fwww.amazon.com%2F&openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0',
    loginUrl: 'https://www.amazon.com/gp/sign-in.html?openid.return_to=https%3A%2F%2Fwww.amazon.com%2F',
    signupUrls: ['https://www.amazon.com/ap/register'],
    loginUrls: ['https://www.amazon.com/ap/signin'],
    passwordChangeUrl: 'https://www.amazon.com/ap/cnep',
    difficulty: 'hard',
    policySource: 'conservative-prototype',
    policyNote: 'Amazon requires OpenID parameters on a direct registration route and is region/anti-automation sensitive; use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: [
        'input#ap_email_login[name="email"]',
        'input#ap_email[name="email"]',
      ],
      password: ['input#ap_password[name="password"]'],
      newPassword: [
        'input#ap_password[name="password"]',
        'input#ap_password_check[name="passwordCheck"]',
      ],
    },
  },
  {
    id: 'ebay',
    label: 'eBay',
    hostnames: ['ebay.com', 'www.ebay.com', 'reg.ebay.com', 'signup.ebay.com'],
    signupUrl: 'https://signup.ebay.com/pa/crte',
    loginUrl: 'https://signin.ebay.com/',
    signupUrls: ['https://reg.ebay.com/reg/PartialReg'],
    passwordChangeUrl: 'https://accountsettings.ebay.com/profile',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: [
        'input#Email[name="Email"]',
        'input#userid[name="userid"]',
      ],
      password: ['input#password[name="password"]'],
      newPassword: ['input#password[name="password"][autocomplete="new-password"]'],
    },
  },
  {
    id: 'paypal',
    label: 'PayPal',
    hostnames: ['paypal.com', 'www.paypal.com'],
    signupUrl: 'https://www.paypal.com/signup',
    loginUrl: 'https://www.paypal.com/signin',
    passwordChangeUrl: 'https://www.paypal.com/myaccount/security',
    difficulty: 'hard',
    policySource: 'conservative-prototype',
    policyNote: 'Financial site with strong anti-abuse; use relaxed20Policy and manual validation only.',
    policy: relaxed20Policy,
    fieldHints: {
      username: [
        'input#email',
        'input[name="login_email"]',
      ],
      email: [
        'input#email',
        'input[name="login_email"]',
      ],
    },
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    hostnames: ['tiktok.com', 'www.tiktok.com'],
    signupUrl: 'https://www.tiktok.com/signup',
    loginUrl: 'https://www.tiktok.com/login',
    passwordChangeUrl: 'https://www.tiktok.com/setting',
    difficulty: 'hard',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy; phone/email verification likely required.',
    policy: relaxed20Policy,
    fieldHints: {
      // The current page exposed only an auth-method chooser. Keep the
      // fallback restricted to explicit account autocomplete semantics.
      username: ['input[name="username"][autocomplete~="username"]'],
      email: ['input[name="email"][autocomplete~="email"]'],
      password: ['input[name="password"][type="password"]'],
    },
  },
  {
    id: 'twitch',
    label: 'Twitch',
    hostnames: ['twitch.tv', 'www.twitch.tv'],
    signupUrl: 'https://www.twitch.tv/signup',
    loginUrl: 'https://www.twitch.tv/login',
    passwordChangeUrl: 'https://www.twitch.tv/settings/security',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input#login-username'],
      registrationUsername: ['input#signup-username'],
      email: ['input#email-input[type="email"]'],
      password: ['input#password-input[type="password"]'],
      newPassword: ['input#password-input[type="password"][autocomplete="new-password"]'],
    },
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    hostnames: ['pinterest.com', 'www.pinterest.com'],
    signupUrl: 'https://www.pinterest.com/',
    loginUrl: 'https://www.pinterest.com/login/',
    signupUrls: ['https://www.pinterest.com/signup/'],
    passwordChangeUrl: 'https://www.pinterest.com/settings/security',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input#email[name="id"][type="email"]'],
      password: ['input#password[name="password"]'],
      newPassword: ['input#password[name="password"][autocomplete="new-password"]'],
    },
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    hostnames: ['login.yahoo.com', 'yahoo.com', 'mail.yahoo.com'],
    signupUrl: 'https://login.yahoo.com/account/create',
    loginUrl: 'https://login.yahoo.com/',
    passwordChangeUrl: 'https://login.yahoo.com/account/security',
    difficulty: 'hard',
    policySource: 'conservative-prototype',
    policyNote: 'Phone verification likely; use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input#username'],
      registrationUsername: ['input#reg-userId'],
      password: ['input#password[type="password"]'],
      newPassword: ['input#reg-password[type="password"]'],
    },
  },
  {
    id: 'proton',
    label: 'Proton Mail',
    hostnames: ['proton.me', 'account.proton.me', 'mail.proton.me'],
    signupUrl: 'https://account.proton.me/start',
    loginUrl: 'https://account.proton.me/login',
    passwordChangeUrl: 'https://account.proton.me/u/0/mail/security',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input#username'],
      registrationUsername: ['input#username'],
      password: ['input#password[type="password"]'],
      newPassword: ['input#password[type="password"][autocomplete="new-password"]'],
    },
  },
  {
    id: 'wordpress',
    label: 'WordPress.com',
    hostnames: ['wordpress.com', 'public-api.wordpress.com'],
    signupUrl: 'https://wordpress.com/start/user',
    loginUrl: 'https://wordpress.com/log-in',
    signupUrls: ['https://wordpress.com/setup/onboarding/user'],
    passwordChangeUrl: 'https://wordpress.com/me/security',
    difficulty: 'easy',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      // Login IDs were audited live. Signup still stops at a staged shell, so
      // its exact username/email IDs remain conservative fallbacks.
      username: ['input#usernameOrEmail[name="usernameOrEmail"][autocomplete~="username"]'],
      registrationUsername: ['input#username[name="username"]'],
      email: ['input#email[name="email"][type="email"]'],
      password: ['input#password[name="password"][autocomplete="current-password"][type="password"]'],
    },
  },
  {
    id: 'medium',
    label: 'Medium',
    hostnames: ['medium.com'],
    signupUrl: 'https://medium.com/m/signin',
    loginUrl: 'https://medium.com/m/signin',
    sharedAuthPage: true,
    credentialMode: 'passwordless',
    passwordChangeUrl: 'https://medium.com/me/settings',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Public authentication is email-link/code or federated; retain this site for auth UI detection, but no password autofill is expected.',
    policy: relaxed20Policy,
  },
  {
    id: 'quora',
    label: 'Quora',
    hostnames: ['quora.com', 'www.quora.com'],
    signupUrl: 'https://www.quora.com/',
    loginUrl: 'https://www.quora.com/',
    sharedAuthPage: true,
    passwordChangeUrl: 'https://www.quora.com/settings',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input#email'],
      email: ['input#email'],
      password: ['input#password[type="password"]'],
    },
  },
  {
    id: 'steam',
    label: 'Steam',
    hostnames: ['steampowered.com', 'store.steampowered.com', 'steamcommunity.com'],
    signupUrl: 'https://store.steampowered.com/join/',
    loginUrl: 'https://store.steampowered.com/login/',
    passwordChangeUrl: 'https://store.steampowered.com/account/',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy; CAPTCHA/email verification likely.',
    policy: relaxed20Policy,
    fieldHints: {
      // The store header search is name="term"; these selectors are restricted
      // to the account-name and join-email fields.
      username: [
        'input[name="username"]:not([type="search"])',
        'input[name="email"][type="email"]',
      ],
      registrationUsername: ['input#accountname[name="accountname"]'],
      email: [
        'input#email[name="email"][type="email"]',
        'input#reenter_email[name="reenter_email"][type="email"]',
      ],
    },
  },
  {
    id: 'epicgames',
    label: 'Epic Games',
    hostnames: ['epicgames.com', 'www.epicgames.com', 'store.epicgames.com'],
    signupUrl: 'https://www.epicgames.com/id/register',
    loginUrl: 'https://www.epicgames.com/id/login',
    passwordChangeUrl: 'https://www.epicgames.com/account/password',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      // Epic did not render an inspectable form in the current audit. Avoid
      // its display-name/full-name controls; retain only explicit account IDs.
      username: ['input#email[name="email"][type="email"][autocomplete~="username"]'],
      registrationUsername: ['input[name="username"][autocomplete~="username"]'],
      email: ['input#email[name="email"][type="email"][autocomplete~="username"]'],
      password: ['input#password[name="password"][autocomplete="current-password"][type="password"]'],
    },
  },
  {
    id: 'booking',
    label: 'Booking.com',
    hostnames: ['booking.com', 'www.booking.com', 'account.booking.com'],
    signupUrl: 'https://account.booking.com/register',
    loginUrl: 'https://account.booking.com/sign-in',
    credentialMode: 'password-or-federated',
    passwordChangeUrl: 'https://account.booking.com/',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy; may prefer passwordless/email code.',
    policy: relaxed20Policy,
    fieldHints: {
      // Do not add #hidden-password here: Booking renders that staging artifact
      // before the actual password step.
      username: ['input#username[name="username"][type="email"]'],
    },
  },
  {
    id: 'airbnb',
    label: 'Airbnb',
    hostnames: ['airbnb.com', 'www.airbnb.com'],
    signupUrl: 'https://www.airbnb.com/signup_login',
    loginUrl: 'https://www.airbnb.com/signup_login',
    signupUrls: ['https://www.airbnb.com/login'],
    loginUrls: ['https://www.airbnb.com/login'],
    sharedAuthPage: true,
    passwordChangeUrl: 'https://www.airbnb.com/account-settings/login-and-security',
    difficulty: 'hard',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy; anti-abuse and phone/email checks likely.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input#phone-or-email'],
    },
  },
  {
    id: 'uber',
    label: 'Uber',
    hostnames: ['uber.com', 'account.uber.com', 'auth.uber.com', 'm.uber.com'],
    credentialOrigin: 'https://auth.uber.com',
    signupUrl: 'https://account.uber.com/',
    loginUrl: 'https://account.uber.com/',
    signupUrls: ['https://auth.uber.com/v2/'],
    loginUrls: ['https://auth.uber.com/v2/'],
    sharedAuthPage: true,
    credentialMode: 'password-or-federated',
    passwordChangeUrl: 'https://account.uber.com/security',
    difficulty: 'hard',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy; phone-based account creation likely.',
    policy: relaxed20Policy,
    fieldHints: {
      username: ['input#PHONE_NUMBER_or_EMAIL_ADDRESS[name="email"][type="email"]'],
    },
  },
  {
    id: 'asana',
    label: 'Asana',
    hostnames: ['asana.com', 'app.asana.com'],
    signupUrl: 'https://asana.com/create-account',
    loginUrl: 'https://app.asana.com/-/login',
    passwordChangeUrl: 'https://app.asana.com/-/profile_settings',
    difficulty: 'medium',
    policySource: 'conservative-prototype',
    policyNote: 'Use relaxed20Policy.',
    policy: relaxed20Policy,
    fieldHints: {
      username: [
        'input[name="e"]',
        'input#email-input',
      ],
      email: ['input#email-input'],
    },
  },
];

const DEFAULT_MULTI_STEP_BEHAVIOR: SupportedPrototypeSite['multiStep'] = {
  login: true,
  signup: true,
  passwordChange: true,
};

export const SUPPORTED_PROTOTYPE_SITES: SupportedPrototypeSite[] =
  SUPPORTED_PROTOTYPE_SITE_DEFINITIONS.map((site) => ({
    ...site,
    credentialOrigin: site.credentialOrigin ?? new URL(site.loginUrl).origin,
    credentialMode: site.credentialMode ?? 'password-or-federated',
    multiStep: site.multiStep ?? DEFAULT_MULTI_STEP_BEHAVIOR,
  }));

export function hostnameMatches(candidate: string, allowed: string): boolean {
  const host = candidate.toLowerCase().replace(/^www\./, '');
  const target = allowed.toLowerCase().replace(/^www\./, '');
  return host === target || host.endsWith(`.${target}`);
}

export function getSupportedSiteForUrl(url: string | undefined): SupportedPrototypeSite | undefined {
  if (!url) return undefined;
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    return undefined;
  }
  return SUPPORTED_PROTOTYPE_SITES.find((site) =>
    site.hostnames.some((allowed) => hostnameMatches(hostname, allowed)),
  );
}

export function isSupportedPrototypeUrl(url: string | undefined): boolean {
  return Boolean(getSupportedSiteForUrl(url));
}

/** Chrome match patterns for the curated study registry. */
export function supportedPrototypeMatchPatterns(): string[] {
  const hostnames = SUPPORTED_PROTOTYPE_SITES.flatMap((site) => site.hostnames)
    .map((hostname) => hostname.toLowerCase().replace(/^www\./, ''));
  return [...new Set(hostnames)]
    .sort()
    .map((hostname) => `*://*.${hostname}/*`);
}
