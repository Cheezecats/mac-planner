# Local acceptance — v0.2 — 2026-10-08

This evidence covers an unsigned Apple Silicon development candidate on macOS 26.5.2. Changes were verified in an isolated checkout based on `fb77413c42c2c15295555edd5a988e3ac801e767`; they have not been published as a v0.2 binary release.

## Current automated and packaged results

- Node 24.14.0: 219 tests across 26 files passed; TypeScript check passed.
- Production renderer/native build, desktop acceptance, Apple Silicon Forge DMG/ZIP packaging, and acceptance against the actual packaged executable passed.
- Native acceptance used separate temporary profiles and a test-only encryption key. The packaged run verified hidden-window New page exactly once, saving before Settings, retaining the buffer after an intentional revision conflict, Back/Forward, Search with real focused Escape input, Today, semantic Reopen, bundled companion access, existing widget isolation/recovery, pending writing/tool state at Quit, and encrypted window bounds.
- Reopen tests cover later writing and unchanged full-editor autosaves, changed/deleted work, reminder choice changes, stale revisions, repeated completion, legacy history recovery/no-history behavior, portable restoration metadata, and template cleanup. Reminder resumption tests deliver future notifications and suppress old due times.
- Search tests cover title/label/body ranking, recent ties, bounded escaped excerpts, second-result selection, and composition keys. Navigation tests cover nested Back/Forward, retained view context, and failed-save/commit rollback.
- Clean-install preparation regression reproduces Electron's lazy extraction and verifies required notices and the versioned companion. This validates the correction locally; it does not replace a fresh hosted run.
- Shutdown regressions hold actual preload requests open, verify no new sends after quiescence, require accepted writing and refreshes to settle before acknowledgement, report failures, resume after an aborted Quit, and reject foreign frames and stale nonces. A native diagnostic probe observed refreshes after the editor's save acknowledgement, confirming the teardown race. Quit now drains requests while the trusted window remains alive, then closes storage before destroying the window.
- The packaged runner requires the completed quiescence marker and reports signal termination before reading results. Screenshot paint waits have a native deadline and never substitute an unpainted capture. One local packaged attempt stalled after the physics screenshot and was killed at the runner's timeout; the immediate rerun passed with saved writing, tool state, window bounds, and request draining verified. The exact stall location was not established by that old log; new deadlines provide a specific diagnostic.
- Independent source review approved the final changes after reminder-restoration, assistant reopen-authorization, breadcrumb timing, and utility-transport findings were corrected and tested.

The runtime is Node 24.14.0 arm64. Vite still reports the large editor bundle. No dependency pins or security isolation were relaxed.

## Observed interface checks

The browser preview used synthetic pages, its own local storage, and the final refreshed source. A development transform cache initially served an older App module; restarting the preview cleared it before final navigation checks.

| Observed flow | Result | Screenshot |
| --- | --- | --- |
| All items, query Review, label Physics → page → Back | Retained All items, query, label, and Open filter | [Returned list](screenshots/v02-all-items-return.jpg) |
| Calendar → November 15 → page → Back | Retained November and the expanded November 15 agenda | [Returned calendar](screenshots/v02-calendar-return.jpg) |
| Search Review → Down → Return | Opened the visibly selected second result; Escape returned focus to Search | [Selected result](screenshots/v02-search-selection.jpg) |
| Complete → add writing → Reopen | Kept the added writing and activated the page | Also covered by native and core checks |
| 900 × 680, Large text, reduced motion, expanded sidebar | Controls remained visible; document/main had no horizontal overflow; sidebar was 176 px | [Narrow page](screenshots/v02-narrow-large-text.jpg) |

Packaged screenshots under `test-results/native/` were inspected at normal and narrow sizes. The publication captures were refreshed from a successful isolated native run, waiting for the intended view to render and dismissing acknowledged messages from deliberate failure probes. The overview and screenshot tour show only synthetic Calendar, Space, page, and actual isolated physics-tool captures. Default measurements remain 48 px collapsed sidebar, 13 px interface text, 14 px writing, and 24 px titles. Chinese characters survived writing and Quit checks; this is not actual IME or VoiceOver evidence. Display removal is covered by bounds-clamping tests, not a physical multi-display trial. Long-list scroll and expanded-group restoration are covered by state/history tests; the small browser fixture did not establish long-list scroll behavior manually.

## Current release boundaries

The [first v0.2 PR run](https://github.com/Cheezecats/mac-planner/actions/runs/37798617935) passed both architecture jobs through native acceptance, packaging, packaged acceptance, and artifact upload. A concurrent [push run](https://github.com/Cheezecats/mac-planner/actions/runs/37798549958) exposed an intermittent Intel shutdown IPC failure after application assertions passed. The correction adds quiescence and request draining; evidence for the updated head is recorded in the [latest PR checks](https://github.com/Cheezecats/mac-planner/pull/1/checks) and pull-request validation table. The earlier [v0.1 hosted run](https://github.com/Cheezecats/mac-planner/actions/runs/37716430566) passed 144 tests but failed before native acceptance because Electron notices were copied before extraction; that preparation failure is resolved on both hosted architectures.

Real eligible ChatGPT inference, Google/Microsoft authorization, provider production verification, Developer ID signing/notarization, signed notification delivery, actual Chinese IME/VoiceOver/contrast validation, physical display changes, and downloaded fresh-install/upgrade recovery remain required. Public source and GitHub Issues are available; production privacy registration and signed binary distribution remain outstanding. Local fixture and packaged checks do not establish those external requirements.

## Historical v0.1 acceptance — 2026-10-07

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
