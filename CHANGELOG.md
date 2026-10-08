# Changelog

## 0.1.0 — development candidate — 2026-10-07

This is the first local implementation candidate. It is not a signed public release, and live optional integrations require the acceptance evidence described below.

- Compact Calendar, Space, and rich task pages share one local workspace, with independent deadlines, planned work, fixed events, weekly occurrence status, opt-in reminders, and completion Undo.
- Editable pages include checklists, tables, code, equations, attachments, folder links, subpages, templates, page-local flashcards and quizzes, and saved interactive tools.
- Encrypted SQLite persistence, Keychain-protected keys, selected-file grants, Trash, copied-asset cleanup, and passphrase-protected backup/restore provide local storage and recovery.
- The optional assistant implements scoped account model discovery, streamed requests, reviewed date suggestions, and revision-checked edits. The Codex companion bundles its runtime and uses the same commands through a private local socket.
- Google and Microsoft adapters implement system-browser authorization, read-only email/calendar access, manual scans, reviewable suggestions, and deduplication. Production consent and live authorization remain unverified until completed with real registrations.
- Mac check and signed candidate workflows cover both architecture-specific builds. Candidate signing, notarization, packaged acceptance, Gatekeeper checks, and checksums require configured release credentials and successful actual runs.

Still required before public distribution: live completed ChatGPT inference, real provider acceptance/verification, signed notification delivery, Intel and fresh-install/upgrade evidence, permanent distribution identity and support/privacy URLs, and final distributable notice review. See [release requirements](docs/release.md) and [provider verification materials](docs/provider-verification.md).
