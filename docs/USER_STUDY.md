# User-study guide

This guide is for researchers and facilitators running the relaxed UpSPA Chrome-extension prototype. Adapt it to the approved protocol, consent form, and institutional data-management requirements for the actual study.

## Scope

The build is suitable for evaluating:

- comprehension of a single master password;
- first-run setup;
- selecting among saved accounts;
- creating or enrolling a website account;
- signing in on one- and multi-step forms;
- understanding explicit confirmation before UpSPA commits changes;
- differentiating website-password update from master-password update;
- recovery from rejected, cancelled, expired, or interrupted flows.

It is not suitable for evaluating production security, distributed compromise tolerance, cross-browser compatibility, or long-term reliability on arbitrary websites.

## Required safety rules

- Use a fresh, disposable Chrome profile.
- Use synthetic identities and disposable study accounts only.
- Do not use primary email, work, school, banking, payment, health, or other valuable accounts.
- Disable Chrome Sync and other password managers in the study profile.
- Never ask a participant to reveal a real password.
- Do not record screens, keystrokes, or identifiers unless the approved consent process explicitly covers it.
- Remove the study profile after the session or follow the approved retention plan.

## Facilitator preflight

Run this shortly before each study wave because third-party websites change frequently.

### Build and automated checks

```bash
pnpm install --frozen-lockfile
pnpm verify
```

Optional distributed regression:

```bash
pnpm test:go
```

Record the commit SHA, Chrome version, operating system, Node/pnpm/Rust/wasm-pack versions, and test results in the session log.

### Browser preparation

1. Create a new Chrome profile with Sync disabled.
2. Load `packages/extension/dist` unpacked.
3. Confirm the name is **UpSPA Relaxed Study**.
4. Confirm Chrome shows access only for the curated study domains.
5. Pin the extension or confirm the side-panel fallback works.
6. Complete setup with a synthetic UID and study master password.
7. Close/reopen the popup and reload the extension once.
8. Confirm setup remains complete and the dashboard opens.

### Website preflight

For every site included in the session:

1. Verify its current login, sign-up, and password-change URLs.
2. Confirm whether the site still supports passwords rather than only passkeys, SSO, or magic links.
3. Check for CAPTCHA, phone verification, rate limits, regional redirects, and consent dialogs.
4. Confirm the content script loads on every hostname/frame used by the task.
5. Confirm the route classifier selects the intended flow.
6. Confirm identifier/current/new/confirmation fields are filled correctly.
7. Confirm no form is automatically submitted.
8. Test cancel, reject, and expiry behavior if those paths are in scope.

Do not include a site in a participant session solely because it appears in the registry.

## Recommended study task sequence

### Task 1: Create the local UpSPA account

Expected path:

```text
setup required -> master password -> checklist -> review -> success
```

Observe whether the participant understands:

- the UID/account field;
- that the master password is different from a website password;
- that the local SP is created automatically;
- the checklist and success state.

### Task 2: Create a website account

Expected path:

```text
supported sign-up route -> account details -> password settings
-> fill website -> participant submits -> explicit Account created
-> commit -> success
```

Failure conditions:

- UpSPA commits before explicit confirmation;
- identifier/password fields are swapped;
- the website form is auto-submitted;
- cancellation leaves a committed record;
- a second account overwrites the first.

### Task 3: Sign in

Expected path:

```text
supported login route -> account picker -> master authentication
-> fill current step -> participant submits/continues
```

For a two-step site, close the popup after the identifier step and verify the password step can continue within the 30-minute window.

### Task 4: Add another account

Verify the participant can find **Add another account** and distinguish:

- **Create a new account**; and
- **Add an existing account**.

For an existing account, use only a disposable credential. The current website password is encrypted temporarily to continue the flow and should be cleared after completion/cancellation/expiry.

### Task 5: Update Website Password

Expected path:

```text
select site/account -> generate replacement -> fill old/new/confirm
-> participant submits -> Password changed or Website rejected it
```

Verify that rejection keeps the old UpSPA record active and that only successful confirmation commits the prepared secret update.

### Task 6: Update Master Password

Expected path:

```text
verify current master -> enter new master -> checklist -> update -> success
```

Verify saved website accounts remain listed and the old master password no longer unlocks the next sensitive action.

## Manual Chrome smoke checklist

### Setup

- [ ] Fresh profile shows setup-required state.
- [ ] Master passwords shorter than six characters are rejected.
- [ ] Mismatched confirmation is rejected.
- [ ] All checklist items are required.
- [ ] Setup succeeds without Go/Postgres/Docker.
- [ ] Reloading the extension preserves setup state.

### Site scope and privacy

- [ ] A registry site loads the content flow.
- [ ] A non-registry site shows no extension injection/access.
- [ ] Unsupported routes do not trigger a credential operation.
- [ ] Background logs do not print page/account event payloads.
- [ ] No form is submitted automatically.

### Registration

- [ ] Site/account details are correct.
- [ ] Registry policy is shown.
- [ ] Username and password fields are filled correctly.
- [ ] Closing/reopening the popup restores the pending flow.
- [ ] Cancel does not commit.
- [ ] **Account created** commits only after website success.

### Authentication

- [ ] Only accounts for the exact enrolled origin are listed.
- [ ] Selecting an account survives popup closure.
- [ ] Identifier-first and password-second pages continue correctly.
- [ ] A wrong master password does not reveal/fill a credential.
- [ ] Lock clears the active session marker.

### Website password update

- [ ] Correct account is selected.
- [ ] Old/new/confirmation fields are distinguished.
- [ ] **Website rejected it** does not commit.
- [ ] **Password changed** commits and future authentication succeeds.

### Master-password update

- [ ] Current master password is verified first.
- [ ] New password and confirmation must match.
- [ ] Checklist is required.
- [ ] Website-account records remain available.

### Recovery

- [ ] Expired flow state is rejected after 30 minutes.
- [ ] Cross-site/tab continuation is rejected.
- [ ] Reloading the extension does not expose plaintext secrets.
- [ ] Removing the study profile clears all local prototype state.

## Reset between sessions

Preferred reset:

1. Close all study-site tabs.
2. Remove the disposable Chrome profile.
3. Create a new profile for the next participant.
4. Load a fresh build of the extension.

Developer-only reset from the extension service-worker console:

```js
await chrome.storage.local.clear();
await chrome.storage.session.clear();
```

Do not use console reset as a substitute for profile disposal when the approved study procedure requires isolation.

## What the repository records

The extension includes no analytics or remote telemetry. It stores operational state in the Chrome profile:

- local SP setup and opaque records;
- saved account/policy/counter metadata;
- encrypted pending/continuation records;
- short-lived session and page-context metadata.

The optional demo login server is an in-memory engineering fixture. It is not part of the participant path and should not be treated as a data-collection backend.

## Session report template

Record at minimum:

```text
Build/commit:
Chrome version:
Operating system:
Study sites and routes:
Synthetic account identifiers used:
Automated verification result:
Manual preflight result:

Task outcomes:
- Setup:
- Registration:
- Authentication:
- Add another account:
- Website password update:
- Master-password update:

Observed route/field mismatch:
Observed recovery issue:
Participant-visible error text:
Reproduction steps:
Screenshots/logs collected under consent:
Data/profile cleanup completed:
```

Avoid copying generated credentials, protocol ciphertexts, key shares, master passwords, or real personal identifiers into issue reports.

## Stop conditions

Stop the task/session if:

- a real personal or valuable account is opened;
- the extension targets the wrong origin/account;
- current/new password fields cannot be distinguished reliably;
- the site would incur a purchase, financial action, policy violation, or irreversible change;
- consent or data-capture scope is unclear;
- the participant cannot safely recover from the current state.
