# Supported study sites

The relaxed prototype contains 40 curated site definitions. Each definition includes hostnames, login/sign-up/password-change routes, difficulty, a password-policy source/note, and optional field hints.

This list is an inventory, not a compatibility guarantee. The executable source of truth is [`packages/extension/src/shared/supportedSites.ts`](../packages/extension/src/shared/supportedSites.ts).

| ID | Site | Preflight difficulty |
|---|---|---|
| `google` | Google / Gmail | hard |
| `microsoft` | Microsoft / Outlook | hard |
| `apple` | Apple Account / iCloud | hard |
| `facebook` | Facebook | hard |
| `instagram` | Instagram | hard |
| `x` | X / Twitter | hard |
| `linkedin` | LinkedIn | medium |
| `github` | GitHub | medium |
| `gitlab` | GitLab | medium |
| `bitbucket` | Bitbucket / Atlassian | medium |
| `stackoverflow` | Stack Overflow | medium |
| `reddit` | Reddit | medium |
| `discord` | Discord | medium |
| `slack` | Slack | medium |
| `zoom` | Zoom | medium |
| `dropbox` | Dropbox | medium |
| `box` | Box | medium |
| `notion` | Notion | medium |
| `figma` | Figma | medium |
| `canva` | Canva | medium |
| `adobe` | Adobe | medium |
| `spotify` | Spotify | easy |
| `netflix` | Netflix | medium |
| `amazon` | Amazon | hard |
| `ebay` | eBay | medium |
| `paypal` | PayPal | hard |
| `tiktok` | TikTok | hard |
| `twitch` | Twitch | medium |
| `pinterest` | Pinterest | medium |
| `yahoo` | Yahoo Mail | hard |
| `proton` | Proton Mail | medium |
| `wordpress` | WordPress.com | easy |
| `medium` | Medium | medium |
| `quora` | Quora | medium |
| `steam` | Steam | medium |
| `epicgames` | Epic Games | medium |
| `booking` | Booking.com | medium |
| `airbnb` | Airbnb | hard |
| `uber` | Uber | hard |
| `asana` | Asana | medium |

## Difficulty meaning

- **easy**: relatively conventional flow in the prototype registry; still requires preflight.
- **medium**: dynamic/multi-step UI, federation, verification, or route churn is likely.
- **hard**: anti-automation, passwordless-first UX, cross-origin flows, payment/identity sensitivity, or strong verification is likely.

Difficulty describes study integration effort, not password strength or site security.

## Policy model

Most sites use `relaxed20Policy`:

- minimum length 16;
- maximum length 20;
- uppercase, lowercase, and digits required;
- symbols disabled by default;
- whitespace forbidden.

The conservative policy reduces cross-site symbol/max-length failures during a usability study. Google, Apple, and GitHub have explicit overrides. Policy sources are labeled `official`, `signup-page-observed`, or `conservative-prototype` in code.

Registry policy notes must be reviewed before each study wave because a website can change its requirements without notice.

## Cross-origin caution

Some definitions span multiple hostnames or use different origins for account creation, login, and settings. Current account records and protocol identifiers use the exact origin. Preflight the complete task sequence on the same origins the participant will use. If an account cannot move from sign-up to login/settings, exclude that task or implement/test a documented credential-scope migration first.

## Adding or updating a site

1. Update the registry entry, routes, policy note/source, and field hints.
2. Add or update registry and classifier tests.
3. Run `pnpm verify`.
4. Reload the unpacked extension so its generated manifest permissions update.
5. Manually test setup, sign-up, sign-in, password update, cancellation, and multi-step continuation.
6. Update this inventory if the site count/label/difficulty changed.

Do not add a broad manifest permission to compensate for an incomplete registry entry.
