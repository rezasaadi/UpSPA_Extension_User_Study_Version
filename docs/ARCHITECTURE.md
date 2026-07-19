# Architecture and flow mapping

This document describes the relaxed user-study implementation. It distinguishes user-facing wording from the underlying UpSPA protocol operations so future UI work does not accidentally change cryptographic meaning.

## Component boundaries

| Component | Responsibility | Must not do |
|---|---|---|
| Options page | First-run setup, checklist, local SP provisioning | Run website flows or persist plaintext master passwords |
| Popup/side panel | Select and coordinate participant flows | Reimplement protocol algorithms |
| Content script | Classify visible forms, fill fields, continue multi-step pages | Commit registrations/updates or submit forms |
| Background worker | Bridge messages, page context, and continuation state | Keep security-critical state only in service-worker memory |
| `upspaActions.ts` | Translate UI operations into `upspa-js` calls | Contain presentation logic |
| `upspa-js` | Coordinate protocol calls across SP clients | Know popup screen state |
| Rust/WASM | UpSPA protocol and cryptographic operations | Know Chrome/storage/UI concepts |
| Local SP adapter | Study-only `1-of-1` SP persistence | Claim distributed trust or production verification |
| Go SP | Optional distributed reference service | Participate in the default study path |

## Default local path

`config.ts` supplies the study default:

```text
storageMode = local-prototype
threshold   = 1
sps         = [{ id: 1, baseUrl: local://sp-1 }]
```

`makeUpspaClient()` creates `UpspaClient` with one injected `LocalStorageProviderClient`. The TypeScript client interface is the same one used by distributed HTTP clients, allowing the UI and protocol core to remain stable.

## User-facing flow to protocol mapping

| User-facing operation | Controller/action path | Protocol meaning | Commit rule |
|---|---|---|---|
| Create UpSPA account | `options.ts` → `setupAndProvision()` | Protocol setup/provision | Setup flag is written only after provisioning succeeds |
| Sign in to website | `handleAuthenticate()` → `authenticateForSite()` | Authentication | No SP commit; fields are filled and participant submits |
| Create website account | `prepareRegistration()` → `prepareRegistrationForSite()` | Registration preparation | `commitRegistrationForSite()` only after **Account created** |
| Add existing account | Import flow reusing registration prepare/commit helpers | Enroll a credential after website password change | Explicit **Existing account updated** confirmation |
| Update Website Password | `prepareSecretUpdateForSite()` | Protocol secret update | `commitSecretUpdateForSite()` only after **Password changed** |
| Update Master Password | `passwordUpdateDirect()` | Protocol password update | Applied after current-password verification, new-password check, and checklist |

“Website password update” and “master-password update” are not interchangeable:

```text
Update Website Password -> UpSPA secret update -> one site/account
Update Master Password   -> UpSPA password update -> protects global client state
```

## Page-classification order

The primary classifier is the curated registry, not generic HTML detection:

```text
1. Is setup complete?
   no  -> setup-required screen

2. Is the hostname in the study registry?
   no  -> unsupported screen

3. Does the URL match a password-change route?
   yes -> website-password-update

4. Does the URL match a sign-up route?
   yes -> website-signup

5. Does the URL match a login route?
   yes -> website-signin

6. Otherwise
   -> dashboard/auth-choice; detected form may refine the result
```

Password-change matching wins because providers sometimes reuse host/path prefixes. Generic form detection refines only dashboard/shared-auth states.

## Flow persistence

Popup documents are destroyed when closed, and Manifest V3 workers can be suspended. The prototype therefore persists bounded flow state.

| State | Storage | Lifetime | Sensitive material |
|---|---|---:|---|
| Active flow metadata | `chrome.storage.session`, local fallback | 30 min | No plaintext master/website password |
| Page context | Session storage, local fallback | 10 sec | URL/form summary only |
| Credential continuation | Encrypted blob in local storage | 30 min | Derived/current website material, encrypted |
| Pending registration | Encrypted blob in local storage | 30 min | Prepared LS/SP registration output, encrypted with master-password-derived key |
| Pending secret update | Encrypted blob in local storage | 30 min | Prepared SP update material, encrypted with master-password-derived key |
| Study session marker | Local storage | 30 min idle | Timestamp only |

Flow metadata is bound where possible to `siteId`, `tabId`, `origin`, `flowId`, and expiry. Stale or cross-site state is rejected.

## Local SP persistence

`LocalStorageProviderClient` stores:

- setup public key and encrypted `cid`;
- the single local TOPRF share;
- per-site/account encrypted `cj` records;
- update timestamps.

The local adapter skips password-update signature verification. This is the largest intentional protocol-boundary relaxation. The Go SP retains signature validation and replay checks.

## Event layer

The small typed event bus coordinates UI/content state. Important intent events include:

- `PAGE_CLASSIFIED`
- `FORM_DETECTED`
- `ACCOUNT_SELECTED`
- `ADD_ANOTHER_ACCOUNT_SELECTED`
- `USER_REQUESTED_SETUP`
- `USER_REQUESTED_SITE_SIGNUP`
- `USER_REQUESTED_SITE_SIGNIN`
- `USER_REQUESTED_ADD_EXISTING_ACCOUNT`
- `USER_REQUESTED_WEBSITE_PASSWORD_UPDATE`
- `USER_REQUESTED_MASTER_PASSWORD_UPDATE`
- `USER_CONFIRMED_ACCOUNT_CREATED`
- `USER_CONFIRMED_WEBSITE_PASSWORD_CHANGED`
- `USER_REPORTED_WEBSITE_REJECTION`
- `FLOW_RESTORED`
- `FLOW_CANCELLED`

The background worker accepts the events for coordination but does not print their payloads, because payloads may contain page/account context.

## Field filling and form submission

The content layer uses:

1. site-specific field hints;
2. route-derived expected flow;
3. generic field detection as fallback;
4. `MutationObserver`-driven re-detection for dynamic pages;
5. tab/site-bound continuation for multi-step forms.

It deliberately does not call `submit()`, `requestSubmit()`, or a site’s submit button. The participant remains responsible for reviewing and submitting the website form.

## Account identity limitation

Saved accounts and cryptographic `lsj` values are currently keyed by the exact page origin. Some registry entries use different origins for sign-up, login, and settings. For example, an account may be created on one origin and later accessed on another.

Do not silently replace exact origins with a site ID: that changes protocol identity and requires a documented migration. Until a canonical credential scope is designed and tested, preflight each study site and avoid cross-origin tasks that cannot reuse an enrolled record.

## Distributed compatibility

The optional distributed code path remains available:

```text
UpspaClient -> HTTP StorageProviderClient -> Go SP -> PostgreSQL
```

It is not provisioned by the normal study setup controller. Its purpose here is regression coverage and protocol development, not participant use.

## Invariants for future changes

- Do not rewrite protocol algorithms in TypeScript UI files.
- Do not persist plaintext master passwords.
- Do not auto-submit website forms.
- Do not commit prepared registration before participant confirmation.
- Do not commit prepared website password update before participant confirmation.
- Do not treat secret update as master-password update.
- Do not overwrite another saved account for the same origin.
- Do not broaden manifest access beyond the registry without an explicit study requirement.
- Do not remove distributed signature verification because local mode skips it.
