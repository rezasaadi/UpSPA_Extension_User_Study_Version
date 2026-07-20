# 40-site browser compatibility audit

Audit date: 2026-07-20

This is a read-only, no-submit structural audit of the relaxed UpSPA user-study extension against the current 40-provider registry. No credential was typed into a live website, no form was submitted, no account was created, and no CAPTCHA or authentication challenge was completed.

The built-in browser was used to inspect visible page structure, routes, and field attributes. The unpacked extension was not installed in that browser profile, so this document does not claim 40/40 installed-extension compatibility. A disposable extension-enabled browser pass remains a release gate.

## Current registry and route count

The registry contains exactly 40 providers:

- 40 login routes;
- 39 ordinary browser registration routes;
- one existing-account-only provider, Turkey e-Devlet, with no invented registration route.

That produces 79 meaningful login/registration routes. The official e-Devlet information page is recorded separately and is not counted as registration.

| Top-document result | Routes | Meaning |
|---|---:|---|
| Identifier and password visible | 34 | Both credential fields were exposed together in the top document. |
| Identifier or non-credential pre-stage visible | 26 | The route was identifier-first, method-first, plan/name/date-of-birth first, or otherwise staged. |
| No top-document credential field | 19 | The page was blank, challenged, already signed in, component/iframe isolated, or did not yet expose a credential field. |
| **Total** | **79** | These are page observations, not installed-extension pass counts. |

Apple is an important exception to the top-document count. Its fields were inspected inside cross-origin Apple frames:

- login: `#account_name_text_field` and `#password_text_field`;
- registration: `input[name="appleId"]`, `input[name="password"]`, and `input[name="confirmPassword"]`;
- first name, last name, phone number, and CAPTCHA are explicitly excluded.

## Replacement-provider evidence

The five current replacements were inspected on 2026-07-20. These are the exact contracts encoded in the registry.

| Provider | Routes | Identifier contract | Password contract | Important exclusions |
|---|---|---|---|---|
| Overleaf | `/login`, `/register` | `#email[name="email"]` | login `#password[autocomplete="current-password"]`; registration `#password[autocomplete="new-password"]` | reCAPTCHA and support/contact form fields |
| n11 | `/giris-yap`, `/uye-ol` | `#email[name="email"]` | `#password[name="password"]` | first/last name, phone, agreement, offer, and site search fields |
| Biletinial | `/tr-tr/WebLogin`, `/tr-tr/WebLogin/Register?lang=tr` | login `input[name="UserName"]`; registration `input[name="Email"]` | login `#inpPassword`; registration `#new_password_input` and `#new_password_confirm` | search, name, phone, birth date, country/city/gender, consent, and reCAPTCHA fields |
| D&R | `/login`, `/uyeol` | login `.js-form-signin input[name="email"]`; registration `.js-form-register input[name="email"]` | login `.js-form-signin #password`; registration `.js-form-register #passwordNew` | adjacent-form duplicate IDs, phone, first/last name, search, consent, and CAPTCHA fields |
| Turkey e-Devlet | `/Giris/gir` plus `/Giris/e-Devlet-Sifresi` alias | `#tridField[name="tridField"][type="number"]` | `#egpField[name="egpField"][type="password"]` | `#captchaField`, hidden `#encTridField`/`#encEgpField`, and alternate identity methods |

Password-policy notes reflect the observed pages:

- Overleaf: at least 8 characters; rejects common passwords and passwords containing parts of the email address. The registry uses a 16-20 character mixed-case alphanumeric candidate.
- n11: 8-15 characters with at least one uppercase letter, one lowercase letter, and one digit.
- Biletinial: 8-24 characters with uppercase and lowercase letters; the compatible candidate also contains a digit.
- D&R: 6-16 characters with at least one letter and one digit.
- e-Devlet: existing-account authentication only; no generated registration password policy is claimed.

## e-Devlet safety boundary

Turkey e-Devlet is deliberately marked:

```text
registrationSupported: false
studyRisk: high-risk-detection-only
credentialOrigin: https://giris.turkiye.gov.tr
```

Only `giris.turkiye.gov.tr` is in the extension host permissions. The wider `turkiye.gov.tr` portal is not injected. The official information URL is metadata only and is not classified as sign-up.

The content adapter has a synthetic DOM test proving that its `type="number"` T.C. Kimlik No field and exact password field can be selected while CAPTCHA and hidden transport fields remain untouched. That test uses an invalid synthetic identifier. It does not authorize entering real government credentials in a study.

## Provider matrix

| # | Provider | Login observation | Registration observation | Study status |
|---:|---|---|---|---|
| 1 | Gmail / Google | Existing browser state redirected away from public login. | Name-first pre-stage. | Retest logged out |
| 2 | Outlook / Microsoft | Email/username first stage. | Email-first stage. | Observed - staged |
| 3 | Apple / iCloud | Exact fields observed in a cross-origin Apple frame. | Exact email/password/confirmation fields observed in frame. | Observed - full in frame |
| 4 | Facebook | Identifier and password visible. | Registration credential fields visible. | Observed - full |
| 5 | Instagram | Identifier and password visible. | Email, username, and password visible; full name excluded. | Observed - full |
| 6 | Overleaf | Exact email and current-password fields visible. | Exact email and new-password fields visible. | Observed - full |
| 7 | LinkedIn | Username/current-password fields visible. | Registration shell did not expose a queryable credential field. | Conditional |
| 8 | GitHub | Combined username-or-email and password visible. | Separate email, username, and password fields visible. | Observed - full |
| 9 | n11 | Exact email and password fields visible. | Email, phone, and password visible; profile/consent fields excluded. | Observed - full |
| 10 | Biletinial | Exact email and password fields visible. | Exact email, password, and confirmation visible; profile/DOB fields excluded. | Observed - full |
| 11 | Stack Overflow | Exact email/password fields visible; search excluded. | Scoped registration fields observed. | Observed - full |
| 12 | Reddit | Accessibility state described credentials, but no queryable top-document inputs appeared. | Same component/frame limitation. | Retest component/frame path |
| 13 | Discord | Exact email and password fields visible. | Email, username, and password visible; display name excluded. | Observed - full |
| 14 | Slack | Email/code-first flow. | Email-first staged flow. | Observed - staged |
| 15 | Zoom | Email-or-phone first stage. | Birth-year pre-stage; DOB is excluded. | Conditional |
| 16 | Dropbox | Email-first stage. | Email-first stage. | Observed - staged |
| 17 | Box | Email-first login. | Email and password visible; name and hCaptcha excluded. | Observed - full/staged |
| 18 | Notion | Email and password visible. | Email and password visible. | Observed - full |
| 19 | Figma | Email and password visible. | Email-first registration. | Observed - full/staged |
| 20 | Canva | Authentication-method shell only. | Method selection required before fields. | Retest after method choice |
| 21 | Adobe | Deep-link shell did not expose a credential field. | Email-first registration stage. | Conditional |
| 22 | Spotify | Email/username first stage. | Email-first registration. | Observed - staged |
| 23 | Netflix | Email and password visible. | Plan-selection pre-stage. | Conditional |
| 24 | Amazon | Mobile/email first stage. | Shared sign-in-or-create first stage. | Observed - staged |
| 25 | eBay | Identifier-first login. | Email and password visible; first/last name excluded. | Observed - full/staged |
| 26 | D&R | Form-scoped email and password visible. | Adjacent registration form has separately scoped email and password fields. | Observed - full |
| 27 | TikTok | Login-method choice before credential fields. | Sign-up-method choice before credential fields. | Retest after method choice |
| 28 | Twitch | Username and password visible. | Email-first registration. | Observed - full/staged |
| 29 | Pinterest | No credential surface rendered in this pass. | No credential surface rendered in this pass. | Retest |
| 30 | Yahoo Mail | Identifier-first login. | Exact user ID and password visible; profile/DOB excluded. | Observed - full/staged |
| 31 | Proton Mail | Username and password visible. | Username-first registration. | Observed - full/staged |
| 32 | WordPress.com | Username/email and password visible. | Onboarding shell did not expose credentials. | Conditional |
| 33 | Turkey e-Devlet | Exact T.C. Kimlik No and password fields visible; CAPTCHA remains manual. | No ordinary browser registration exists. | High-risk detection-only |
| 34 | Quora | Email and password visible on shared page. | Shared credential page. | Observed - full |
| 35 | Steam | Account name and password visible; search excluded. | Email-first stage; search excluded. | Observed - full/staged |
| 36 | Epic Games | Email and password visible. | DOB pre-stage; DOB excluded. | Conditional |
| 37 | Booking.com | Email-first shared route; hidden password artifact excluded. | Same shared staged route. | Observed - staged |
| 38 | Airbnb | Phone/email first shared route. | Same shared staged route. | Observed - staged |
| 39 | Uber | Email/phone first stage on `auth.uber.com`. | Same shared staged identity route. | Observed - staged |
| 40 | Asana | Identifier-first login. | Email-first registration. | Observed - staged |

## Implemented registry, detection, and permission checks

- The registry remains exactly 40 entries and contains the five current replacements.
- Manifest host permissions are derived from the registry. Permissions for removed providers are absent.
- e-Devlet injection is restricted to `giris.turkiye.gov.tr`; its information URL is not injected or classified as registration.
- All current password-capable providers have scoped identifier hints.
- Replacement selectors are covered with DOM fixtures, including D&R's adjacent duplicate-ID forms.
- e-Devlet's numeric identifier is covered by a full content-script login-fill fixture; CAPTCHA and hidden encrypted fields remain empty, and registration fill is refused.
- Search, profile/display-name, first/last/full-name, date-of-birth, hidden, CAPTCHA, OTP/PIN/code, and known decoy fields remain excluded by shared safety rules.

Focused verification after these registry changes passed 41 tests across:

- registry and credential-origin behavior;
- replacement field-hint contracts;
- route classification;
- Manifest V3 host permissions;
- multi-step content filling and the e-Devlet safety fixture.

Integrated verification produced the release build and passed the extension TypeScript check, 13 JavaScript client/real-WASM tests, 97 extension tests, Rust formatting, workspace Clippy with warnings denied, seven executable Rust protocol/setup/TOPRF tests, and all Go storage-provider packages under Go 1.25.0. Windows Application Control blocked execution of the separate pre-existing `vectors_aead` test binary after it compiled; the real-WASM and protocol-flow suites still exercised authenticated Cid/Cj encryption and exact migrated/updated-password round trips.

## Remaining installed-extension gate

Before participant testing, load `packages/extension/dist` unpacked in a disposable, logged-out extension-enabled browser profile and repeat every meaningful route. For each usable stage:

1. Confirm that the in-field icon is visible, aligned, clickable, and restored after SPA navigation or DOM replacement.
2. Confirm that the side panel opens without obscuring its own controls.
3. Use synthetic study markers only; verify the intended identifier/password field receives the correct marker and unrelated fields remain unchanged.
4. On iframe pages, confirm only the ranked credential frame is filled.
5. Navigate identifier-first flows manually and verify continuation only on the matching provider and expected password stage.
6. Confirm that OTP/PIN/code, security questions, search, profile/display-name, DOB, hidden, CAPTCHA, and cross-provider frame fields remain untouched.
7. Do not submit a form, solve a CAPTCHA, create an account, or complete authentication unless the study protocol separately authorizes it.
8. For e-Devlet, perform structural detection only with no real T.C. Kimlik number or government password.

Current honest status: routes, selectors, safety contracts, and replacement-provider live structures have been audited; 40/40 installed-extension behavior has not yet been proven.
