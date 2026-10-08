# Changelog

## 0.2.0 — development candidate — 2026-10-08

This candidate improves everyday navigation, completion, search, and Mac commands while retaining the compact interface. Source, native, and packaged Apple Silicon acceptance passed locally; signing and live integration requirements remain open.

- Opening a task retains its Calendar period/day or Space tab, query, filters, group expansion, and scroll position. Back follows the actual origin, including nested pages; failed saves retain the editing buffer.
- **Reopen** restores unchanged work and reminders disabled by completion while preserving later writing, schedule edits, and deleted entries. Restoration metadata survives portable backups; older pages use completion history when available. General Undo remains separate.
- Search ranks title, label, and writing matches, shows excerpts, supports arrow selection and Return, and restores focus on Escape. Composition keystrokes do not open results.
- Focus contains active tasks. All items retains completed/archived filters; empty Focus links to it. Work, Due, and Event markers explain dates.
- Native menus and the menu-bar New page action use the editor save guard, work with a hidden window, and queue until the renderer is ready. Window bounds are encrypted and clamped to available displays. Settings reports backup, reminder, and companion operations separately.
- Runtime preparation initializes Electron before copying its required notices, correcting the clean-install failure that prevented hosted native checks.
- Quit drains accepted editor and background requests before closing storage and the window. Failed saving or drain acknowledgement keeps the window usable with its editing buffer.

Validation: 219 tests across 26 files, TypeScript, production build, desktop acceptance, Apple Silicon DMG/ZIP packaging, and packaged native acceptance passed. The first hosted PR run passed both architectures; a parallel Intel run exposed a shutdown race corrected with additional drain tests. See [current acceptance](docs/acceptance.md) and [latest pull-request checks](https://github.com/Cheezecats/mac-planner/pull/1/checks). Signing/notarization, real account/provider flows, signed notifications, actual Chinese IME/VoiceOver, and downloaded-install/upgrade validation remain release gates.

## 0.1.0 — development candidate — 2026-10-07

This is the first local implementation candidate. It is not a signed public release, and live optional integrations require the acceptance evidence described below.

- Compact Calendar, Space, and rich task pages share one local workspace, with independent deadlines, planned work, fixed events, weekly occurrence status, opt-in reminders, and completion Undo.
- Editable pages include checklists, tables, code, equations, attachments, folder links, subpages, templates, page-local flashcards and quizzes, and saved interactive tools.
- Encrypted SQLite persistence, Keychain-protected keys, selected-file grants, Trash, copied-asset cleanup, and passphrase-protected backup/restore provide local storage and recovery.
- The optional assistant implements scoped account model discovery, streamed requests, reviewed date suggestions, and revision-checked edits. The Codex companion bundles its runtime and uses the same commands through a private local socket.
- Google and Microsoft adapters implement system-browser authorization, read-only email/calendar access, manual scans, reviewable suggestions, and deduplication. Production consent and live authorization remain unverified until completed with real registrations.
- Mac check and signed candidate workflows cover both architecture-specific builds. Candidate signing, notarization, packaged acceptance, Gatekeeper checks, and checksums require configured release credentials and successful actual runs.

Still required before public distribution: live completed ChatGPT inference, real provider acceptance/verification, signed notification delivery, Intel and fresh-install/upgrade evidence, permanent distribution identity and support/privacy URLs, and final distributable notice review. See [release requirements](docs/release.md) and [provider verification materials](docs/provider-verification.md).
