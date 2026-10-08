# Provider registration and verification packet

This packet describes implemented data flows and the evidence still needed for public distribution. It is preparation material, not provider approval or proof of successful live sign-in. Use test accounts with synthetic mail and calendar entries for recordings; redact account identifiers and never record tokens or private sources.

## Registration inventory

Complete this table before submitting production registrations. Use separate development and production clients.

| Field | Required release value / evidence |
| --- | --- |
| Publisher / verified domains | Maintainer-owned identity and domain; not configured yet |
| App name / permanent bundle ID | Planner / choose a permanent identifier before distribution; current development identifier is `local.planner.workspace` |
| Public source, support, privacy URLs | Publish real maintained URLs; this repository has no production endpoints configured |
| Signed app version / commit / architectures | Candidate workflow evidence plus checksums for arm64 and x64 |
| Public desktop client IDs | Google and Microsoft registration IDs supplied as `PLANNER_GOOGLE_CLIENT_ID` / `PLANNER_MICROSOFT_CLIENT_ID` |
| Provisioning | Release build writes public IDs into bundled `runtime/public-config.json`; runtime environment overrides are available for testing. Verify Finder launch without environment overrides. No credential belongs in this file. |
| Acceptance owner and date | Named maintainer, test account type, date, version, and pass/fail for each checklist below |

## Actual data flows

| Flow | Data sent / retained | User control |
| --- | --- | --- |
| Local planner | Pages, dates, study attempts, tools, copied assets, and history are encrypted on the Mac; decrypted search stays in memory | Use without accounts; selected files/folders only; Trash, permanent deletion, and encrypted portable backups |
| Provider authorization | System browser sends the authorization grant to a temporary local listener; access/refresh credentials are encrypted with the app key protected by Keychain | Decline consent, reconnect, or disconnect |
| Manual email scan | Selected folders and date interval are read from the provider; snippets and source IDs produce local suggestions. Default is Inbox and the last 30 days | Start each scan explicitly; edit ambiguous dates; accept/dismiss; incomplete pagination is reported |
| Calendar refresh | Selected external calendars/events are fetched as observations, shown in read-only overlays | Select calendars; disconnect; no provider calendar writes |
| Assistant request | Current saved page, page-local conversation history, and explicitly selected attached sources are sent to OpenAI; Responses requests disable storage | Optional sign-in; send intentionally; cancel; review inferred dates; Undo requested edits |
| Email-derived assistant context | An accepted page may contain an email excerpt. A later request about that page can transmit that excerpt to OpenAI | No automatic email scan-to-assistant transfer; disclose this user-selected secondary flow in production review |
| Codex companion | An explicitly invoked Codex tool reads/edits canonical pages via a private local socket. Read content then enters the user's Codex service context | Install companion intentionally; Planner must run; no import of other conversations |

Disconnect removes that account's credentials and temporary provider observations, stops fetching, and retains accepted local pages. Permanent page deletion removes its local records, app-owned assistant history, and unshared copied assets. Linked originals remain untouched. Prior backups and external application copies require separate deletion. [Privacy policy source](privacy.md) describes these boundaries.

## Sign in with ChatGPT

The implementation uses the local open-source SIWC route: dynamic registration, system-browser sign-in, PKCE/state/nonce validation, and local encrypted sessions. Current requested scopes are `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. Do not request or import ChatGPT conversation history. Confirm the current preview/account eligibility and consent UI against the [SIWC registration contract](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) before recording.

Populate the model picker from the signed-in account's `GET /v1/models` catalog. Use its selected slug for streamed `POST /v1/responses` with `store: false`. A redirect, token, first text delta, or HTTP 200 is insufficient; inference succeeds only with the terminal `response.completed` event. [OpenAI models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

- [ ] On the signed candidate, complete real eligible account sign-in, model discovery, and a minimal response through `response.completed`; retain redacted evidence.
- [ ] Demonstrate cancellation, interrupted/incomplete/failed streams, expired authorization, usage-limit recovery, and intentional retry.
- [ ] Demonstrate current-page scope, an explicitly selected source, direct requested edits with a visible summary/Undo, and rejection of stale revisions.
- [ ] Demonstrate reviewed inferred deadline changes and continued offline planner use after an account failure.
- [ ] Verify account switching/disconnect cannot reuse another account's authorization or history.

## Google Gmail and Calendar

Create a Google Cloud project with Gmail API and Calendar API enabled and a Desktop app OAuth client. Test system-browser PKCE using the actual `http://127.0.0.1:<ephemeral>/auth/callback` listener. The supported installed-app flow uses a loopback redirect; validate this client registration with the shipped app. [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)

The exact requested scopes are:

| Scope | Purpose |
| --- | --- |
| `openid`, `profile`, `email` | Identify the connected account |
| `https://www.googleapis.com/auth/gmail.readonly` | Read selected mail for manual deadline suggestions; no sending/modifying |
| `https://www.googleapis.com/auth/calendar.events.readonly` | Read event observations for overlays |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | List calendars for explicit selection |

Prepare consent branding, verified domains, public support/privacy URLs, scope justifications, and a synthetic-data video showing authorization, folder/date selection, scan, source/date review, accept/dismiss, overlay refresh, disconnect, and deletion. The video must show incomplete/ambiguous cases as well as the normal flow.

The production submission must disclose retained snippets and the optional later transmission of email-derived page context to OpenAI/Codex. Determine the applicable restricted-scope verification, Limited Use obligations, and security assessment for that actual flow; do not assert a local-only exemption while this transfer remains available. [Google restricted-scope production review](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)

- [ ] Add test users and complete live authorization with denied/partial scopes and expired/revoked tokens.
- [ ] Scan a synthetic multi-page mailbox fully; interrupt pagination and confirm visible incomplete status.
- [ ] Repeat accepted/dismissed scans without duplication; show follow-up changed deadlines remaining reviewable.
- [ ] Verify selected calendar overlays never alter local work plans or write to Google.
- [ ] Verify disconnect stops requests and removes credentials while accepted pages remain.
- [ ] Record production verification/security-assessment determination and approval before enabling general distribution.

## Microsoft Outlook and Calendar

Register an Entra public desktop client using the Mobile and desktop applications platform. Choose the actual supported audience; the app currently uses the `common` tenant for organizational and personal accounts. The callback is `http://localhost:<ephemeral>/auth/callback`, with the listener bound to `127.0.0.1`; register the localhost path as a native redirect and validate it with real accounts. Microsoft's localhost matching permits ephemeral ports. [Microsoft redirect configuration](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url#localhost-exceptions)

Request delegated scopes `openid profile email offline_access User.Read Mail.Read Calendars.Read`. `User.Read` identifies the account, `Mail.Read` supplies selected mail, and `Calendars.Read` supplies overlays. Do not add application permissions, `Mail.Send`, or calendar write scopes. Publish accurate consent branding, publisher/support/privacy information, and a synthetic recording equivalent to Google's sequence.

- [ ] Complete live personal and organization-account authorization for the intended audience; show tenant/admin-consent restrictions accurately.
- [ ] Verify the exact callback and refresh route in the signed candidate, including expiry, revoked consent, cancellation, and denied permission.
- [ ] Prove complete/incomplete scans, stable deduplication, ambiguous-date editing, read-only overlays, and disconnect behavior.
- [ ] Confirm public IDs work on Finder launch and retain production registration/publisher-review evidence.

## Evidence and approval record

Keep a versioned, redacted acceptance record identifying the candidate checksums, platform/account type, test date, result, and reviewer for each gate. Store approval references privately if they expose registration details. Fixture tests prove adapter behavior under controlled responses; they do not establish live provider acceptance. Optional integration failures must leave offline planning usable.
