# Frozen implementation interfaces

Types: src/shared/types.ts. UI `window.planner.request<T>(method, params)` and `subscribe`. All mutations publish changed.

Core service: `new PlannerService(repository)`; repository `getSnapshot(): WorkspaceSnapshot`, `replaceSnapshot(snapshot)`, transactional persistence/undo interface chosen in core. Export `createEmptyWorkspace(): WorkspaceSnapshot`, `getCalendarOccurrences(snapshot,fromDate,toDate): CalendarOccurrence[]`, `getFocusGroups(snapshot,todayDate,nowISO?): {attention:Page[],pinned:Page[],today:Page[],upcoming:Page[]}` from src/core/domain.ts.

`PlannerService.execute(method:string,params:Record<string,unknown>={}): unknown` is synchronous except repository optional backup helpers; no network/native operations. src/core/service.ts exports PlannerService. src/core/repository.ts exports EncryptedRepository(databasePath:string,key:Buffer) with getSnapshot(), replaceSnapshot(), close(). Native safeStorage protects supplied key; tests use test keys. Node crypto encryption applied to persisted JSON blobs; no plaintext content/index on disk.

## Domain methods

- workspace.get => WorkspaceSnapshot
- page.create {title?,parentId?,deadline?,labels?,blocks?} => Page
- page.update {id,expectedRevision,changes} => Page (only permitted Page fields)
- page.patch {id,expectedRevision,operations} => Page; operations insert/update/delete block by ID; preserve unknown blocks
- page.complete {id,expectedRevision} => Page; deactivate work with history/undo
- page.reopen {id,expectedRevision} => PageReopenResult {page,restoredEntryCount,skippedEntryCount,message}; reopen a completed page and restore only unchanged completion-disabled work/reminders, preserving later edits and deleted entries
- page.undo {id} => Page; restore latest page transaction with revision conflict protection
- page.duplicate {id,asTemplate?:boolean} => Page; clear dates/completion/practice and remap stable block/resource IDs
- page.instantiate {id} => Page; template to active page
- page.archive/page.delete/page.restore {id,expectedRevision} => Page
- page.purge {id} => void; only trashed
- schedule.create {pageId,blockId?,title?,kind:'event'|'work',when,endTime?,repeat?,reminder?} => CalendarEntry
- schedule.update {id,expectedRevision,changes,scope?:'one'|'future',occurrenceDate?} => CalendarEntry
- schedule.move {id,expectedRevision,when,occurrenceDate?,scope?:'one'|'future'} => CalendarEntry
- schedule.status {id,expectedRevision,status,occurrenceDate?} => CalendarEntry
- schedule.remove {id,expectedRevision} => void
- label.create {name,color?} => Label; label.update {id,name?,color?} => Label; label.delete {id}
- study.save {record:StudyRecord,expectedRevision?} => StudyRecord
- widget.save {record:WidgetRecord,expectedRevision?} => WidgetRecord
- asset.save {record:AssetRecord} => AssetRecord; asset.remove {id}
- suggestion.upsert {suggestions:SourceSuggestion[]} => count; accepted/dismissed statuses preserved on duplicate IDs/candidate keys
- suggestion.accept {id,title?,date:DateValue,updatePageId?,expectedRevision?} => Page
- suggestion.dismiss {id} => void
- connection.save {record:Connection} => Connection; connection.remove {id} => void (keep pages, remove temporary provider caches)
- calendar.import {connectionId,events:ImportedEvent[]} => void
- settings.update {changes:Partial<Settings>} => Settings
- workspace.export => portable snapshot (no credentials/temporary connections/caches)
- workspace.import {snapshot} => void; validate all IDs/references before replacing

## Native/platform methods

- file.attach/file.link {pageId,folder?:boolean} => AssetRecord|null; native chooser only
- file.open {id}; file.locate {id}; file.read {id} => selected-source text
- backup.configure {password} => settings (choose folder); backup.create {password?}; backup.restore {password} => snapshot (choose archive); export.markdown {id}; export.workspace {password}
- connection.connect {provider:'google'|'microsoft'} => Connection; connection.scan {id,folder?,from?,to?} => {count,complete,errors?}; connection.folders {id}; connection.calendars {id}; connection.refresh {id,calendarIds?,from?,to?}; connection.disconnect {id}
- assistant.signIn => Connection; assistant.models => {slug,display_name}[]; assistant.send {pageId,text,model?,assetIds?} => {started:true}; assistant.cancel {pageId}; assistant.history {pageId}
- widget.mount {id,bounds:{x,y,width,height}}; widget.bounds {id,bounds}; widget.stop {id}; widget.reload {id}; widget.revert {id,version}; widget.unmount {id}
- app.openPage {id,blockId?}; app.notificationsStatus; app.companionInfo; app.loadExample (explicit sample-workspace action); app.quit
- app.rendererReady => {received:true}; acknowledge only after workspace/history and the event subscription are installed, then drain queued native commands/page opens

Native emits AppEvent types in shared types. Renderer desktop bridge is authoritative. Browser preview may use IndexedDB local fallback explicitly labeled preview; it must not impersonate Keychain/native integrations.

Native menus and the menu-bar New page action emit `ui-command` with `{command: PlannerUICommand}`. Commands are `new-page`, `search`, `settings`, `today`, `back`, and `forward`. The renderer owns execution through its existing save guard; commands arriving during startup are queued until the renderer is ready. Native menu accelerators own desktop shortcuts so a command is not executed twice.

Completion restoration data is portable and encrypted with the page. Reopening uses its saved post-completion values/revisions rather than the latest generic Undo record. Old pages can recover state from their completion history; without it, reopening activates the page and explains that no plans were restored. Templates and duplicates clear restoration data and reminder-resumption state.

Reminder lead times are validated from zero through 525600 minutes (one year), bounding recurrence expansion. Date-only reminders use their chosen local time, default 09:00.
