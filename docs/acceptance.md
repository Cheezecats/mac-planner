# Local acceptance — 2026-10-07

This is evidence for an unsigned Apple Silicon development candidate on macOS 26.5.2. It is not a public-release signoff.

## Automated verification

- TypeScript check: passed.
- Test suite: 144 tests in 14 files passed, including a normal parallel run.
- Production renderer/native build: passed. Vite reports a large editor bundle; this is a performance warning, not a failed build.
- Apple Silicon Forge package: passed; better-sqlite3's shipped Node-API prebuild loaded in the packaged utility process.
- Bundled runtime: Node 24.14.0 arm64; architecture mismatch is rejected by packaging.
- Dependency notice inspection: bundled Node license, Electron/Chromium notices, production dependency inventory, and dependency license files are included.

Tests cover deadline/work independence, date-only and timezone/DST behavior, weekly occurrence status, parent completion/Undo, Focus deduplication and next action, encrypted storage and revision conflicts, unknown blocks, templates/resources/study attempts, portable Trash, encrypted backups and failed restore, original-file preservation, temporary-copy cleanup, permanent history purge, reminder opt-in/no delayed burst, OAuth validation/cancellation/refresh, provider pagination/deduplication/ambiguity/read-only calendars, assistant stream completion/cancellation/scope, and denied tool access.

## Packaged native acceptance

The native harness creates a separate temporary profile with a test-only encryption key; it does not read the person's existing workspace or account credentials. Its final result and screenshots are under `test-results/native/`.

- Moving work leaves its page deadline unchanged.
- BlockNote loads in the packaged renderer.
- The bundled MCP process completes its protocol handshake, lists supported tools, and searches/reads the same canonical page.
- Editor/menu geometry uses 48 px sidebar, 13 px interface type, 14 px writing, and 24 px titles.
- Native tools hide for Insert overlays and return afterward.
- Network/file/Node/main-app bridge access is denied to the hostile probe.
- Rapid tool-state writes retain the latest state; crash and infinite-loop recovery leave the editor responsive.
- Reload retains the last physics state; stale-view cleanup does not remove its replacement.
- Closing and reopening the window retains the native tool.
- Starting the native tool through the page UI, expanding/collapsing the sidebar, and moving its mass slider preserve alignment and change the graph. Its default surface remains white when the Mac uses dark appearance.
- Parent completion and Undo succeed.
- Normal and narrow screens are captured and inspected.
- Immediate Quit preserves pending Chinese title text and the last tool state, checked by decrypting the test database after process exit.
- The database process acknowledges closing after accepted requests; shutdown IPC errors fail acceptance.

The Codex protocol check proves the bundled server route. It does not prove marketplace installation inside a real Codex account. Reminder delivery through the real signed macOS permission path is not simulated by this harness.

## Outstanding release evidence

- Real eligible ChatGPT sign-in, account model discovery, and terminal completed inference.
- Real Google/Microsoft test registrations, consent, denied/expired access, Finder provisioning, and full provider flows.
- Production Gmail verification/security assessment and Microsoft registration approval as applicable.
- Developer ID signing/notarization, signed notification delivery, downloaded install, and upgrade/Keychain identity recovery.
- Intel package/hardware checks and both architecture release workflows actually running.
- Chinese IME composition, VoiceOver, and broader accessibility/device coverage.
- Published maintained source/support/privacy URLs, public marketplace installation, and final license/distribution audit.

See [release instructions](release.md), [provider verification packet](provider-verification.md), and [visual QA](../design-qa.md). The signed candidate workflow prepares both architectures and checksums, but has not been executed with Apple credentials.
