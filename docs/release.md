# Release and acceptance

This repository provides a local development candidate. A public release is gated on actual signed-package, account, provider, and architecture checks; source implementation and fixture tests do not substitute for them.

The [changelog](../CHANGELOG.md) records the candidate scope. [Provider verification materials](provider-verification.md) give the registration inventory, actual consent/data flows, and external proof checklist. Neither document claims approvals have been obtained.

## Build

Use Node 24 and `npm ci` from the lockfile. Run typecheck, all tests, production build, then native smoke. `npm run make -- --arch=arm64` creates an Apple Silicon app/DMG/ZIP under `out/`. An Intel build must bundle an Intel Node runtime and database binary; never relabel an arm64 package as x64.

`PLANNER_EXECUTABLE=/absolute/path/Planner.app/Contents/MacOS/Planner node scripts/desktop-smoke.mjs` runs acceptance against a packaged app. It creates a separate temporary profile. Inspect the emitted result and screenshots; a successful process launch alone is insufficient.

Supply the public Google/Microsoft client IDs before preparing the release runtime. They are embedded in `runtime/public-config.json`, with runtime environment overrides for test registrations. Verify account connections when opening the packaged app from Finder without those overrides. This configuration contains public IDs only, never account tokens or signing material.

## Signed candidate workflow

`.github/workflows/release-mac.yml` runs for matching `v<package.json version>` tags or manual dispatch. It uses actual Apple Silicon (`macos-15`) and Intel (`macos-15-intel`) runners, runs source acceptance, imports a temporary Developer ID keychain, builds and notarizes the app, verifies signatures/architecture/Gatekeeper, runs packaged acceptance, signs/notarizes/staples the DMG, and recreates the ZIP from the stapled app. The final artifact contains SHA-256 checksums, candidate provenance, and validation evidence.

Configure a protected `release-candidate` GitHub environment with the intended maintainer reviewers. Add these environment secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE_P12_BASE64` | Base64-encoded Developer ID Application certificate/private-key export |
| `APPLE_CERTIFICATE_PASSWORD` | Password protecting that `.p12` |
| `APPLE_SIGN_IDENTITY` | Exact `Developer ID Application: ...` identity |
| `APPLE_TEAM_ID` | Expected signing team for signature verification |
| `APPLE_API_KEY_BASE64` | Base64-encoded notarization API `.p8` key |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | The notarization key ID and issuer UUID |

Set environment/repository variables `PLANNER_GOOGLE_CLIENT_ID` and `PLANNER_MICROSOFT_CLIENT_ID` to the appropriate public production IDs. Leave them empty only for an intentionally offline candidate. The workflow decodes signing material into a private temporary folder, restores the keychain search list, and removes its temporary keychain and keys even on failure. It never includes keys, test profiles, or account credentials in artifacts.

The workflow has read-only repository permissions and uploads candidates only after all candidate checks pass. It does not publish GitHub releases or configure an update feed. Missing credentials fail the signed workflow; the separate Mac-check workflow still produces explicitly named development artifacts. A candidate's signing/packaged smoke is not proof of real notification delivery, live account inference, provider approval, or a fresh downloaded installation.

## Apple distribution

Provide a Developer ID Application identity through `APPLE_SIGN_IDENTITY`. Notarization uses `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`. Keep signing material outside the repository. Choose a permanent app identifier before first public distribution; the development identifier is `local.planner.workspace`.

Verify both Apple Silicon and Intel packages on appropriate hardware:

- editor typing, Chinese input, autosave/navigation, immediate Quit/relaunch;
- encrypted database/native module loading and Keychain across restarts;
- copied assets, linked-file Locate, Trash, backup/restore, migrations and interrupted writes;
- real notification permission/delivery, window close versus Quit, and resume without delayed bursts;
- widget network/filesystem/credential/IPC denial, rapid state persistence, Stop, crash and infinite-loop containment;
- compact and narrow layouts, keyboard operation, focus management, text size, reduced motion;
- bundled companion startup, protocol handshake and shared revision conflicts.

Run `codesign --verify --deep --strict` and Gatekeeper assessment, staple notarization tickets, then test a fresh download/install outside the development checkout. Replace signed updates only while Planner is quit. Preserve the data directory/Keychain key; migrations first create recovery copies. No unverified automatic update feed is enabled.

Before approving distribution, download each final candidate artifact, verify its `SHA256SUMS.txt`, mount the DMG, copy Planner to Applications, and open it from Finder on the target architecture. Repeat the native acceptance and real notification checks using the downloaded copy. Upgrade an existing non-private test workspace and deliberately exercise a failed migration/restore before approving recovery. Keep the candidate version/commit/checksums with the evidence. These manual gates are not bypassed by creating a tag.

## OpenAI and provider registrations

Prove real Sign in with ChatGPT, account-specific model discovery, and a streamed request ending in completed inference. Verify cancellation, expiration, failed inference, selected-source scope, edits with Undo, and stale revisions. Do not claim live compatibility from transport fixtures.

Google production registration must disclose Gmail/calendar scopes, local extraction/caching, retained excerpts, and any user-selected transfer of email-derived context to OpenAI. Supply an accurate privacy policy and consent demonstration; satisfy restricted-scope verification and applicable security assessment. Microsoft registration must use the actual redirect route and delegated read-only permissions. Test complete pagination, denied permissions, expired tokens, rescan deduplication, ambiguous dates, and disconnect.

Primary contracts: [OpenAI inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [plugin packaging](https://developers.openai.com/plugins/build/plugins), [Google restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

## Public repository and support

Before release, choose the repository/support/privacy URLs, add screenshots and onboarding instructions, audit distributable dependency licenses/notices, enable signed artifacts for both architectures, and publish a versioned changelog/checksums. Do not commit secrets, test profiles, private backups, or credentials.

The signed-candidate workflow and changelog are supplied; actual successful signed runs, final notice review, hosted support/privacy URLs, screenshots/onboarding, and public publication remain release gates. Review the generated `Resources/runtime/notices` inventory together with Electron's runtime notices and all shipped dependency/font notices. After all external and downloaded-install gates pass, a maintainer may approve publication of those exact checksum-verified candidates. Publication is a separate authorized action.

The repository marketplace is the initial Codex distribution route. Universal-directory listing requires the supported local-MCP route to be accepted separately. Sync, collaboration, sending email, remote calendar writes, and unrestricted desktop automation remain outside the first release.
