# Mac planner implementation plan

> For agentic workers: use reviewed delegated tasks and maintain .superpowers/sdd/planner/progress.md. The user approved this written plan in chat and explicitly requested execution.

Goal: deliver the local Mac planner and its optional integrations without confusing a usable unsigned development build with production provider/Apple approval.
Architecture: Electron main owns lifecycle/native operations; utility service is single SQLite writer; React renderer calls narrow request/subscribe bridge; MCP uses same commands via private socket.
Spec: ../specs/2026-10-07-planner-design.md

## Global constraints
- Same page ID across Calendar/Space/assistant/MCP.
- 13px UI, 14px content, 24px heading, collapsed48/expanded176 sidebar.
- Page deadline distinct from sessions/events; explicit parent completion; weekly occurrence status independent.
- Encrypt at rest, revision-check edits, preserve unknown blocks and use lossless JSON.
- Requested page edits with Undo; inferred deadline/mail acceptance reviewed.
- No broad disk access, sends, remote calendar writes, cloud sync, or credential exports.
- Reminders only while running; window close stays in menu bar, Quit stops; no delayed burst.
- Public production authorization/signing are external gates, not silently simulated.

## Review focus
- Concurrent user/assistant mutation never overwrites newer revisions.
- Completed task and recurring missed work never generate phantom active sessions.
- Restored archives validate all references and do not export tokens.
- Generated source cannot escape widget surface or freeze the UI.
- Partial provider scans and interrupted streams never report success.

## Tasks
1. Contracts/build foundation: shared/types.ts, package/build configs, pinned packages, packaged loading tests.
2. Domain/storage: src/core only; meaningful failing tests first for encrypted SQLite, scheduling/Focus/recurrence/completion/Undo/exports.
3. Renderer: src/renderer only; accepted compact Calendar/Space/editor/study/settings connections UI; request APIs exactly from shared contract and interface reference.
4. Integrations: src/integrations only; test-first provider/OAuth/Responses/local extraction; no live credentials or auth initiated without user action in app.
5. Native service: src/electron, runtime scripts; secure preload/utility writer/file grants/widgets/reminders/backups/bridge.
6. Companion/release: src/companion, plugin manifests, docs, signed runtime packaging and registration materials.
7. Integration/visual QA: typecheck/tests/build/packaged launch, UI primary journeys, screenshot comparisons, revise issues.

Every task has test evidence plus spec/quality review. Controller owns root configs and integration wiring. Mutations to disjoint source ownership may run concurrently; shared contracts freeze before dispatch. Record deviations in ledger.
