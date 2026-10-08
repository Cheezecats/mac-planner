# Mac planner and task workspace — approved design

The user explicitly requested implementation of this design on 2026-10-07. The in-chat written plan and its execution method were approved by that request; recording it here does not introduce a new approval gate.

## Outcome

Free open-source local Mac app: full-month calendar, clean Focus/All items Space, and rich editable canonical task pages. One Mac first; optional assistant and Codex companion; read-only Gmail/Outlook mail and calendar connections. No collaboration, cloud sync, email sending, broad computer automation, or remote-calendar writes in v1.

## Visual requirements

Native Mac font, charcoal/gray on white/near-white, subdued icons, optional label color. 13px interface, 14px document text, 24px titles, 32px controls. Sidebar 48px collapsed and 176px expanded; click only; persisted choice. First launch Calendar, later restore view. Search, keyboard navigation, adjustable text, reduced motion.

The accepted concept images informed this visual direction. Public implementation captures are available for [Space](../../screenshots/space.png) and the [task page](../../screenshots/page-insert.png); the original local concept images are not distributed.

## Canonical pages and dates

Every calendar occurrence and Space row points to one page ID. A page has optional deadline; fixed events and planned work are separate entries. Day-first work has optional time/end time. Moving one entry changes neither deadline nor other entries. Scheduled checklist entries point to a stable block ID without creating another page.

Past fixed events are history. Deadline remains overdue until explicit parent completion. Missed work stays unfinished until done, rescheduled, or cancelled. Checkbox, session, and parent completion are independent. Completing a page deactivates outstanding work/reminders, preserving dates and unfinished status; fixed events remain. Undo reverses only the transition's changes and checks revisions rather than overwriting later edits.

Weekly repeats have occurrence-level state; edit one or this-and-future. Date-only values keep their date; timed values retain IANA zone; repeating times retain their original wall time.

Month default with Week switch; three entries per month cell plus overflow. Clicking a date opens upward stacked agenda, clamped to viewport. Calendar shows every occurrence; opening a checkbox session focuses its block.

Reminders opt-in per entry. User explicitly selected only-while-running delivery. Closing window leaves menu-bar process; Quit stops delivery. No native after-quit helper. Reopen shows missed work without old notification burst.

## Space

Focus precedence Needs attention > Pinned > Today > Upcoming. One row per page. Upcoming deadlines/events include today through seven days ahead. Missed/overdue and pinned items are horizon exceptions. Manual pins, chronological dates; completed hidden. All includes undated ideas and label/status filters. Multiple flexible labels, not mandatory folders.

## Editor and study

New opens blank editable page with title focus and optional metadata. One searchable Insert reached via button, inline +, or slash. Text/headings/toggles/lists/checklists/tables/code/math/images/files/folder links/subpages/cards/quizzes/widgets. Autosave, Undo, block movement, duplication, templates; template instantiation clears dates, completion, practice history.

Cards reveal/Again/Got it and saved progress. Quiz multiple-choice plus short-answer; feedback, saved attempts, retry, short-answer self-assessment, optional assistant feedback. Practice is page-local. First custom tool: interactive physics diagram/sliders/graph. Assistant can create reusable additional tools.

## Persistence and recovery

Electron app owns a single utility-process SQLite writer. Shared validated commands for UI/assistant/MCP, stable IDs, revision checks, atomic changes/history. BlockNote versioned JSON authoritative; Markdown companion export. Preserve unknown blocks. Encrypt content and credentials; keys in Mac Keychain; memory-only plaintext search index.

Attach copies file into protected app storage. Link references selected original. Missing links Locate. Only selected files/folders readable. Trash/restore/explicit permanent delete. Portable archive includes structured content, copied assets, widgets/source/state; excludes tokens/temporary caches; references stay references. Passphrase-protected daily backup to selected folder while running, seven versions. Validate restore before replacement. Pre-migration backup; preserve original on failure.

## Assistant and widgets

Optional collapsible assistant. Current page and explicitly selected sources only. Direct requested page edits with Undo/change summary (accepted as plan default); inferred deadlines/email suggestions reviewed. SIWC official OSS local flow, scopes/model discovery, streaming Responses, local conversation history, completed inference required; no ChatGPT conversation import.

Widgets isolated web contents, no Node/network/files/secrets, narrow provided-input/own-state bridge. Stop/Reload/version rollback. Validate hostile/infinite-loop/crash containment.

## Connections and companion

Manual scans default Inbox and last 30 days, selected folders/account/range. Complete pagination or visibly mark partial. Source excerpt + date; ambiguity edit; accepted/dismissed dedup via stable IDs; follow-up proposes update. Google/Microsoft read-only scopes and browser OAuth. Calendar read-only overlays; disconnect removes tokens/stops fetching, preserves accepted pages.

Local Codex companion exposes search/read/edit/schedule/open via same service, private socket, packaged runtime. Repo-marketplace initial distribution. Public-directory local MCP support is a release dependency.

## Delivery and tests

Initial stable pins Electron44.6.0/React19.3.0/TS7.0.2/BlockNote0.55.0/better-sqlite3-13.0.3/Forge8.0.1/MCP2.3.1. Verify real packaged compatibility; do not assume install means behavior works.

Milestones foundation/package -> offline planner -> study/widgets -> assistant/companion -> connectors -> public release preparation. Signed/notarized arm64/x64 delivery depends on Apple credentials. Real provider authorization requires publisher/test registrations; public Gmail review/security assessment covers actual AI data flows.

Acceptance: October15 essay plus October12/14 sessions; move/complete/Undo; independent weekly missed work; canonical views and concurrent edits; restart/backup/migration custom-block persistence; hostile widget isolation; dedup/ambiguous/changed-source review; denied scopes, expired auth, interrupted streams, missing files, disk failures; compact normal/narrow visuals/Chinese IME/keyboard/reduced motion; real signed notifications and quit behavior.
