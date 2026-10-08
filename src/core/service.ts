import type {
  AssetRecord,
  CalendarEntry,
  Connection,
  DateValue,
  Page,
  PageBlock,
  PageCompletionState,
  PageReopenResult,
  SourceSuggestion,
  ReminderSpec,
  StudyRecord,
  WidgetRecord,
  WorkspaceSnapshot,
} from "../shared/types";
import {
  addDays,
  flattenBlocks,
  isSeriesDate,
  validateDate,
  validateWorkspace,
} from "./domain";
import type { HistoryEntry, RecordChange, RepositoryLike } from "./repository";

// Kept structurally compatible with the shared optional portable-trash field.
type PortableTrashState = {
  status: Exclude<Page["status"], "trashed">;
  reminder?: ReminderSpec;
  entries: {
    id: string;
    active: boolean;
    reminder?: ReminderSpec;
    revisionAfterTrash: number;
  }[];
};
type PortablePage = Page & { trashState?: PortableTrashState };
const clone = <T>(v: T): T => structuredClone(v);
const uuid = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function completionState(
  before: Page,
  after: Page,
  changes: RecordChange[],
): PageCompletionState {
  return {
    ...(before.reminder?.enabled && !after.reminder?.enabled
      ? {
          reminder: {
            before: clone(before.reminder),
            after: clone(after.reminder!),
            deadline: clone(before.deadline),
          },
        }
      : {}),
    entries: changes
      .filter(c => c.collection === 'entries' && c.before && c.after)
      .map(c => {
        const old = c.before as CalendarEntry, next = c.after as CalendarEntry;
        return {
          id: c.id,
          active: old.active,
          reminder: clone(old.reminder),
          revisionAfterCompletion: next.revision,
        };
      }),
  };
}
function assertRevision(item: { revision: number }, expected: unknown): void {
  if (expected !== item.revision)
    throw new Error(
      `Revision conflict: expected ${String(expected)}, current ${item.revision}`,
    );
}
function pick<T extends object>(
  changes: Record<string, unknown>,
  allowed: readonly string[],
): Partial<T> {
  for (const key of Object.keys(changes))
    if (!allowed.includes(key))
      throw new Error(`Field cannot be changed: ${key}`);
  return clone(changes) as Partial<T>;
}
function newPage(values: Partial<Page> = {}): Page {
  const timestamp = now();
  return {
    id: uuid(),
    title: "",
    blocks: [],
    deadline: null,
    labels: [],
    status: "active",
    pinned: false,
    pinOrder: 0,
    parentId: null,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    trashedAt: null,
    isTemplate: false,
    ...values,
  };
}
const collections = [
  "pages",
  "entries",
  "studies",
  "widgets",
  "assets",
] as const;
function changesBetween(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): RecordChange[] {
  const result: RecordChange[] = [];
  for (const collection of collections) {
    const old = new Map(before[collection].map((item) => [item.id, item]));
    const fresh = new Map(after[collection].map((item) => [item.id, item]));
    for (const id of new Set([...old.keys(), ...fresh.keys()])) {
      const a = old.get(id) ?? null,
        b = fresh.get(id) ?? null;
      if (JSON.stringify(a) !== JSON.stringify(b))
        result.push({ collection, id, before: clone(a), after: clone(b) });
    }
  }
  return result;
}
function rewriteReferences(
  value: unknown,
  mapping: Map<string, string>,
): unknown {
  if (typeof value === "string") return mapping.get(value) ?? value;
  if (Array.isArray(value))
    return value.map((v) => rewriteReferences(v, mapping));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rewriteReferences(v, mapping)]),
    );
  return value;
}

/** Synchronous shared command boundary. Mutations validate the entire graph before one atomic commit. */
export class PlannerService {
  private volatileHistory: HistoryEntry[] = [];
  constructor(private readonly repository: RepositoryLike) {}
  execute(method: string, params: Record<string, unknown> = {}): unknown {
    const state = clone(this.repository.getSnapshot());
    if (method === "workspace.get") return state;
    if (method === "workspace.export") {
      state.connections = [];
      state.suggestions = [];
      state.importedEvents = [];
      delete state.settings.backupPath;
      delete state.settings.backupLastAt;
      state.settings.backupEnabled = false;
      return state;
    }
    if (method === "workspace.import") {
      validateWorkspace(params.snapshot);
      this.repository.replaceSnapshot(clone(params.snapshot));
      this.volatileHistory = [];
      return;
    }
    const before = clone(state),
      history = clone(this.repository.getHistory?.() ?? this.volatileHistory);
    const p = params as Record<string, any>;
    const findPage = (id: unknown): Page => {
      const result = state.pages.find((x) => x.id === id);
      if (!result) throw new Error("Page not found");
      return result;
    };
    const findEntry = (id: unknown): CalendarEntry => {
      const result = state.entries.find((x) => x.id === id);
      if (!result) throw new Error("Calendar entry not found");
      return result;
    };
    const touch = (page: Page) => {
      page.revision++;
      page.updatedAt = now();
    };
    const disable = (page: Page, all = false) => {
      if (page.reminder?.enabled) page.reminder.enabled = false;
      for (const entry of state.entries.filter((e) => e.pageId === page.id)) {
        let changed = false;
        if (
          entry.active &&
          entry.kind === "work" &&
          (all ||
            entry.status === "planned" ||
            Object.values(entry.exceptions).some(
              (exception) => exception.status === "planned",
            ))
        ) {
          entry.active = false;
          changed = true;
        }
        if (entry.reminder?.enabled) {
          entry.reminder.enabled = false;
          changed = true;
        }
        if (changed) entry.revision++;
      }
    };
    const deactivateMissingBlocks = (page: Page) => {
      const ids = new Set(flattenBlocks(page.blocks).map((b) => b.id));
      for (const e of state.entries)
        if (
          e.pageId === page.id &&
          e.blockId &&
          !ids.has(e.blockId) &&
          e.active
        ) {
          e.active = false;
          if (e.reminder) e.reminder.enabled = false;
          e.revision++;
        }
    };
    let result: unknown, historyPage: string | undefined;
    switch (method) {
      case "page.create": {
        const values = pick<Page>(p, [
          "title",
          "parentId",
          "deadline",
          "labels",
          "blocks",
        ]);
        const page = newPage(values);
        state.pages.push(page);
        result = page;
        break;
      }
      case "page.resource": {
        const page = findPage(p.pageId);
        assertRevision(page, p.expectedRevision);
        if (page.status === "trashed")
          throw new Error("Restore the page before inserting a resource");
        if (!["study", "widget"].includes(p.kind))
          throw new Error("Invalid resource kind");
        const record = clone(p.record) as StudyRecord | WidgetRecord;
        const block = clone(p.block) as PageBlock;
        if (!record || record.pageId !== page.id || !block?.props)
          throw new Error("Resource and block must belong to the target page");
        const referenceKey = p.kind === "study" ? "studyId" : "widgetId";
        if (
          block.props[referenceKey] !== record.id &&
          block.props.resourceId !== record.id
        )
          throw new Error("Block must reference the inserted resource");
        if (
          [...state.studies, ...state.widgets, ...state.assets].some(
            (r) => r.id === record.id,
          )
        )
          throw new Error("Resource ID already exists");
        record.revision = 1;
        if (p.kind === "study") state.studies.push(record as StudyRecord);
        else {
          const widget = record as WidgetRecord;
          widget.version = 1;
          widget.versions = [];
          state.widgets.push(widget);
        }
        page.blocks.push(block);
        touch(page);
        historyPage = page.id;
        result = page;
        break;
      }
      case "page.update": {
        const page = findPage(p.id);
        assertRevision(page, p.expectedRevision);
        const changes = pick<Page>(p.changes ?? {}, [
          "title",
          "blocks",
          "deadline",
          "labels",
          "pinned",
          "pinOrder",
          "parentId",
          "isTemplate",
          "reminder",
        ]);
        const reminderChanged =
          ('reminder' in changes && !equal(page.reminder, changes.reminder)) ||
          ('deadline' in changes && !equal(page.deadline, changes.deadline));
        Object.assign(page, changes);
        if (page.completionState && reminderChanged)
          delete page.completionState.reminder;
        deactivateMissingBlocks(page);
        touch(page);
        historyPage = page.id;
        result = page;
        break;
      }
      case "page.patch": {
        const page = findPage(p.id);
        assertRevision(page, p.expectedRevision);
        if (!Array.isArray(p.operations))
          throw new Error("Block operations required");
        for (const op of p.operations) {
          const type = op.type ?? op.op,
            id = op.id ?? op.blockId;
          const locate = (
            nodes: PageBlock[],
          ): { list: PageBlock[]; index: number } | undefined => {
            for (let index = 0; index < nodes.length; index++) {
              if (nodes[index].id === id) return { list: nodes, index };
              const child = locate(nodes[index].children ?? []);
              if (child) return child;
            }
          };
          if (type === "insert") {
            if (!op.block) throw new Error("Block required");
            let list = page.blocks;
            if (op.parentId) {
              const parent = flattenBlocks(page.blocks).find(
                (b) => b.id === op.parentId,
              );
              if (!parent) throw new Error("Parent block not found");
              list = parent.children ?? (parent.children = []);
            }
            let index = op.index ?? list.length;
            if (op.afterId) {
              const previous = list.findIndex((b) => b.id === op.afterId);
              if (previous < 0)
                throw new Error("Insert anchor block not found");
              index = previous + 1;
            }
            if (!Number.isInteger(index) || index < 0 || index > list.length)
              throw new Error("Invalid block insertion index");
            list.splice(index, 0, clone(op.block));
          } else {
            const target = locate(page.blocks);
            if (!target) throw new Error("Block target not found");
            if (type === "delete") target.list.splice(target.index, 1);
            else if (type === "update") {
              const changes = pick<PageBlock>(op.changes ?? op.patch ?? {}, [
                "type",
                "props",
                "content",
                "children",
              ]);
              if (changes.props)
                changes.props = {
                  ...target.list[target.index].props,
                  ...changes.props,
                };
              Object.assign(target.list[target.index], changes);
            } else throw new Error("Unknown block operation");
          }
        }
        deactivateMissingBlocks(page);
        touch(page);
        historyPage = page.id;
        result = page;
        break;
      }
      case "page.complete":
      case "page.archive":
      case "page.delete": {
        const page = findPage(p.id);
        assertRevision(page, p.expectedRevision);
        if (page.status === "trashed")
          throw new Error("Restore the page before changing it");
        if (method === 'page.complete' && page.status === 'completed') {
          result = page;
          break;
        }
        if (method === "page.delete") {
          (page as PortablePage).trashState = {
            status: page.status,
            reminder: clone(page.reminder),
            entries: state.entries
              .filter((e) => e.pageId === page.id)
              .map((e) => ({
                id: e.id,
                active: e.active,
                reminder: clone(e.reminder),
                revisionAfterTrash: e.revision,
              })),
          };
        }
        page.status =
          method === "page.complete"
            ? "completed"
            : method === "page.archive"
              ? "archived"
              : "trashed";
        if (page.status === "trashed") page.trashedAt = now();
        disable(page, method !== "page.complete");
        if (method === 'page.complete')
          page.completionState = completionState(
            before.pages.find(x => x.id === page.id)!, page, changesBetween(before, state),
          );
        if (method === "page.delete")
          for (const saved of (page as PortablePage).trashState!.entries)
            saved.revisionAfterTrash = findEntry(saved.id).revision;
        touch(page);
        historyPage = page.id;
        result = page;
        break;
      }
      case "page.reopen": {
        const page = findPage(p.id);
        assertRevision(page, p.expectedRevision);
        if (page.status !== 'completed') throw new Error('Only completed pages can be reopened');
        let saved = page.completionState;
        let restorationUnavailable = false;
        if (!saved) {
          const completionIndex = history.findLastIndex(h =>
            h.pageId === page.id && h.method === 'page.complete' && !h.undone &&
            h.changes.some(c => c.collection === 'pages' && c.id === page.id &&
              (c.before as Page)?.status !== 'completed' &&
              (c.after as Page)?.status === 'completed'),
          );
          const completion = history[completionIndex];
          const change = completion?.changes.find(c => c.collection === 'pages' && c.id === page.id);
          if (!change?.before || !change.after) {
            saved = { entries: [] };
            restorationUnavailable = true;
          } else {
            saved = completionState(change.before as Page, change.after as Page, completion.changes);
            const reminderChanged = history.slice(completionIndex + 1).some(h =>
              !h.undone && h.changes.some(c => c.collection === 'pages' && c.id === page.id &&
                (!equal((c.before as Page)?.reminder, (c.after as Page)?.reminder) ||
                 !equal((c.before as Page)?.deadline, (c.after as Page)?.deadline))),
            );
            if (reminderChanged) delete saved.reminder;
          }
        }
        let restoredEntryCount = 0, skippedEntryCount = 0;
        const blockIds = new Set(flattenBlocks(page.blocks).map(b => b.id));
        for (const savedEntry of saved.entries) {
          const entry = state.entries.find(e => e.id === savedEntry.id && e.pageId === page.id);
          if (!entry || entry.revision !== savedEntry.revisionAfterCompletion ||
              (savedEntry.active && entry.blockId && !blockIds.has(entry.blockId))) {
            skippedEntryCount++;
            continue;
          }
          entry.active = savedEntry.active;
          entry.reminder = clone(savedEntry.reminder);
          entry.revision++;
          restoredEntryCount++;
        }
        if (saved.reminder && equal(page.reminder, saved.reminder.after) &&
            equal(page.deadline, saved.reminder.deadline))
          page.reminder = clone(saved.reminder.before);
        page.status = 'active';
        page.remindersResumedAt = now();
        delete page.completionState;
        touch(page);
        historyPage = page.id;
        const restored = `Restored ${restoredEntryCount} scheduled ${restoredEntryCount === 1 ? 'entry' : 'entries'}`;
        const skipped = skippedEntryCount
          ? `; skipped ${skippedEntryCount} changed or deleted ${skippedEntryCount === 1 ? 'entry' : 'entries'}`
          : '';
        result = {
          page, restoredEntryCount, skippedEntryCount,
          message: restorationUnavailable
            ? 'Page reopened. Completion restoration data is unavailable; no schedules or reminders were restored.'
            : `Page reopened. ${restored}${skipped}.`,
        } satisfies PageReopenResult;
        break;
      }
      case "page.restore": {
        const page = findPage(p.id);
        assertRevision(page, p.expectedRevision);
        if (page.status !== "trashed") throw new Error("Page is not trashed");
        let saved = (page as PortablePage).trashState;
        if (!saved) {
          const deletion = [...history]
            .reverse()
            .find(
              (h) =>
                h.pageId === page.id && h.method === "page.delete" && !h.undone,
            );
          if (!deletion)
            throw new Error("Trash restoration state is unavailable");
          const old = deletion.changes.find(
            (c) => c.collection === "pages" && c.id === page.id,
          )?.before as Page;
          if (old.status === "trashed")
            throw new Error("Invalid trash restoration state");
          saved = {
            status: old.status,
            reminder: clone(old.reminder),
            entries: deletion.changes
              .filter((c) => c.collection === "entries")
              .map((c) => ({
                id: c.id,
                active: (c.before as CalendarEntry).active,
                reminder: clone((c.before as CalendarEntry).reminder),
                revisionAfterTrash: (c.after as CalendarEntry).revision,
              })),
          };
        }
        for (const entryState of saved.entries) {
          const entry = state.entries.find(
            (e) => e.id === entryState.id && e.pageId === page.id,
          );
          if (!entry || entry.revision !== entryState.revisionAfterTrash)
            throw new Error(
              "Revision conflict: linked entry changed after trash",
            );
          entry.active = entryState.active;
          entry.reminder = clone(entryState.reminder);
          entry.revision++;
        }
        page.status = saved.status;
        page.trashedAt = null;
        page.reminder = clone(saved.reminder);
        delete (page as PortablePage).trashState;
        touch(page);
        historyPage = page.id;
        result = page;
        break;
      }
      case "page.undo": {
        const target = [...history]
          .reverse()
          .find((h) => h.pageId === p.id && !h.undone);
        if (!target) throw new Error("No page changes to undo");
        for (const change of target.changes) {
          const current =
            state[change.collection].find((x) => x.id === change.id) ?? null;
          if (JSON.stringify(current) !== JSON.stringify(change.after))
            throw new Error(
              "Revision conflict: an affected record changed after this transaction",
            );
        }
        for (const change of target.changes) {
          const list = state[change.collection] as unknown as Array<
            Record<string, any>
          >;
          const index = list.findIndex((x) => x.id === change.id);
          if (change.before === null) {
            if (index >= 0) list.splice(index, 1);
          } else {
            const restored = clone(change.before) as Record<string, any>;
            if ("revision" in restored)
              restored.revision =
                ((change.after as { revision?: number } | null)?.revision ??
                  restored.revision) + 1;
            if (change.collection === "pages") restored.updatedAt = now();
            if (index >= 0) list[index] = restored;
            else list.push(restored);
            const previous = [...history]
              .reverse()
              .find(
                (h) =>
                  h !== target &&
                  !h.undone &&
                  h.changes.some(
                    (c) =>
                      c.collection === change.collection &&
                      c.id === change.id &&
                      JSON.stringify(c.after) === JSON.stringify(change.before),
                  ),
              );
            const previousChange = previous?.changes.find(
              (c) => c.collection === change.collection && c.id === change.id,
            );
            if (previousChange) previousChange.after = clone(restored);
          }
        }
        target.undone = true;
        result = findPage(p.id);
        break;
      }
      case "page.duplicate":
      case "page.instantiate": {
        const original = findPage(p.id);
        if (method === "page.instantiate" && !original.isTemplate)
          throw new Error("Only templates can be instantiated");
        const copied = newPage({
          ...clone(original),
          id: uuid(),
          title: original.title,
          deadline: null,
          status: "active",
          pinned: false,
          pinOrder: 0,
          revision: 1,
          createdAt: now(),
          updatedAt: now(),
          trashedAt: null,
          isTemplate: method === "page.duplicate" && !!p.asTemplate,
          reminder: undefined,
        });
        delete (copied as PortablePage).trashState;
        delete copied.completionState;
        delete copied.remindersResumedAt;
        const mapping = new Map<string, string>([[original.id, copied.id]]);
        for (const b of flattenBlocks(copied.blocks)) mapping.set(b.id, uuid());
        const studies = state.studies.filter((s) => s.pageId === original.id),
          widgets = state.widgets.filter((w) => w.pageId === original.id),
          assets = state.assets.filter((a) => a.pageId === original.id);
        for (const resource of [...studies, ...widgets, ...assets])
          mapping.set(resource.id, uuid());
        for (const study of studies)
          for (const item of [...study.cards, ...study.questions])
            mapping.set(item.id, uuid());
        copied.blocks = rewriteReferences(
          copied.blocks,
          mapping,
        ) as PageBlock[];
        for (const block of flattenBlocks(copied.blocks)) {
          if ("checked" in block.props) block.props.checked = false;
          if ("completed" in block.props) block.props.completed = false;
        }
        for (const study of studies) {
          const next = rewriteReferences(study, mapping) as StudyRecord;
          next.revision = 1;
          next.attempts = [];
          for (const card of next.cards) {
            delete card.review;
            delete card.reviewedAt;
          }
          state.studies.push(next);
        }
        for (const widget of widgets) {
          const next = rewriteReferences(widget, mapping) as WidgetRecord;
          next.revision = 1;
          next.state = {};
          state.widgets.push(next);
        }
        for (const asset of assets)
          state.assets.push(rewriteReferences(asset, mapping) as AssetRecord);
        state.pages.push(copied);
        result = copied;
        break;
      }
      case "page.purge": {
        const page = findPage(p.id);
        if (page.status !== "trashed")
          throw new Error("Only trashed pages can be permanently deleted");
        state.pages = state.pages.filter((x) => x.id !== page.id);
        for (const other of state.pages) {
          let changed = false;
          if (other.parentId === page.id) {
            other.parentId = null;
            changed = true;
          }
          for (const block of flattenBlocks(other.blocks))
            for (const key of ["pageId", "subpageId"])
              if (block.props[key] === page.id) {
                delete block.props[key];
                changed = true;
              }
          if (changed) touch(other);
        }
        state.entries = state.entries.filter((x) => x.pageId !== page.id);
        state.studies = state.studies.filter((x) => x.pageId !== page.id);
        state.widgets = state.widgets.filter((x) => x.pageId !== page.id);
        state.assets = state.assets.filter((x) => x.pageId !== page.id);
        for (const suggestion of state.suggestions) {
          if (suggestion.pageId === page.id) delete suggestion.pageId;
          if (suggestion.possibleUpdatePageId === page.id)
            delete suggestion.possibleUpdatePageId;
        }
        for (let i = history.length - 1; i >= 0; i--)
          if (
            history[i].pageId === page.id ||
            history[i].changes.some(
              (c) =>
                (c.before as { pageId?: string } | null)?.pageId === page.id,
            )
          )
            history.splice(i, 1);
        break;
      }
      case "schedule.create": {
        const page = findPage(p.pageId);
        if (page.status !== "active" || page.isTemplate)
          throw new Error("Scheduling requires an active page");
        const input = pick<CalendarEntry>(p, [
          "pageId",
          "blockId",
          "title",
          "kind",
          "when",
          "endTime",
          "repeat",
          "reminder",
        ]);
        const entry: CalendarEntry = {
          ...input,
          id: uuid(),
          pageId: page.id,
          kind: p.kind,
          when: clone(p.when),
          active: true,
          status: "planned",
          exceptions: {},
          revision: 1,
        };
        state.entries.push(entry);
        result = entry;
        break;
      }
      case "schedule.move":
      case "schedule.status":
      case "schedule.update": {
        const entry = findEntry(p.id);
        assertRevision(entry, p.expectedRevision);
        const changes =
          method === "schedule.move"
            ? { when: clone(p.when) }
            : method === "schedule.status"
              ? { status: p.status }
              : pick<CalendarEntry>(p.changes ?? {}, [
                  "title",
                  "blockId",
                  "kind",
                  "when",
                  "endTime",
                  "active",
                  "status",
                  "repeat",
                  "reminder",
                ]);
        if (p.scope && !["one", "future"].includes(p.scope))
          throw new Error("Invalid occurrence scope");
        if (p.occurrenceDate) {
          if (!isSeriesDate(entry, p.occurrenceDate))
            throw new Error("Invalid occurrence date");
          if (entry.repeat && p.scope === "future") {
            const originalDate = p.occurrenceDate as string;
            const newEntry: CalendarEntry = {
              ...clone(entry),
              ...changes,
              id: uuid(),
              when: clone(
                changes.when ?? { ...entry.when, date: originalDate },
              ),
              revision: 1,
              exceptions: {},
            };
            if (
              newEntry.repeat?.until &&
              changes.when &&
              !("repeat" in changes)
            ) {
              const dayShift = Math.round(
                (Date.parse(newEntry.when.date) - Date.parse(originalDate)) /
                  86400000,
              );
              newEntry.repeat.until = addDays(newEntry.repeat.until, dayShift);
            }
            const futureExceptions = Object.entries(entry.exceptions).filter(
              ([d]) => d >= originalDate,
            );
            for (const [d, exception] of futureExceptions) {
              const offset = Math.round(
                (Date.parse(d) - Date.parse(originalDate)) / 86400000,
              );
              newEntry.exceptions[addDays(newEntry.when.date, offset)] =
                clone(exception);
            }
            if (originalDate === entry.when.date) {
              Object.assign(entry, newEntry, {
                id: entry.id,
                revision: entry.revision + 1,
              });
              result = entry;
            } else {
              entry.repeat.until = addDays(originalDate, -1);
              entry.exceptions = Object.fromEntries(
                Object.entries(entry.exceptions).filter(
                  ([d]) => d < originalDate,
                ),
              );
              entry.revision++;
              state.entries.push(newEntry);
              result = newEntry;
            }
          } else if (entry.repeat) {
            for (const key of Object.keys(changes))
              if (!["when", "status", "endTime"].includes(key))
                throw new Error(
                  "This field requires a whole-series or future edit",
                );
            entry.exceptions[p.occurrenceDate] = {
              ...entry.exceptions[p.occurrenceDate],
              ...changes,
            };
            entry.revision++;
            result = entry;
          } else {
            Object.assign(entry, changes);
            entry.revision++;
            result = entry;
          }
        } else {
          if (entry.repeat && p.scope)
            throw new Error("Occurrence date required");
          if (
            changes.when &&
            entry.repeat &&
            changes.when.date !== entry.when.date &&
            Object.keys(entry.exceptions).length
          )
            throw new Error(
              "Choose one occurrence or this-and-future when moving a series with exceptions",
            );
          Object.assign(entry, changes);
          entry.revision++;
          result = entry;
        }
        break;
      }
      case "schedule.remove": {
        const entry = findEntry(p.id);
        assertRevision(entry, p.expectedRevision);
        state.entries = state.entries.filter((x) => x.id !== entry.id);
        break;
      }
      case "label.create": {
        if (typeof p.name !== "string" || !p.name.trim())
          throw new Error("Label name required");
        const label = {
          id: uuid(),
          name: p.name.trim(),
          ...(p.color ? { color: p.color } : {}),
        };
        state.labels.push(label);
        result = label;
        break;
      }
      case "label.update": {
        const label = state.labels.find((x) => x.id === p.id);
        if (!label) throw new Error("Label not found");
        if (p.name !== undefined) {
          if (typeof p.name !== "string" || !p.name.trim())
            throw new Error("Label name required");
          label.name = p.name.trim();
        }
        if (p.color !== undefined) label.color = p.color;
        result = label;
        break;
      }
      case "label.delete": {
        state.labels = state.labels.filter((x) => x.id !== p.id);
        for (const page of state.pages)
          if (page.labels.includes(p.id)) {
            page.labels = page.labels.filter((x) => x !== p.id);
            touch(page);
          }
        break;
      }
      case "study.save":
      case "widget.save": {
        const record = clone(p.record) as StudyRecord | WidgetRecord;
        if (!record) throw new Error("Record required");
        findPage(record.pageId);
        const list = state[
          method === "study.save" ? "studies" : "widgets"
        ] as Array<StudyRecord | WidgetRecord>;
        const index = list.findIndex((x) => x.id === record.id);
        if (index >= 0) {
          const old = list[index];
          assertRevision(old, p.expectedRevision);
          if (old.pageId !== record.pageId)
            throw new Error("Cannot move a resource between pages");
          record.revision = old.revision + 1;
          if (method === "widget.save") {
            const w = record as WidgetRecord,
              prior = old as WidgetRecord;
            w.versions = clone(prior.versions);
            w.version = prior.version;
            if (w.source !== prior.source) {
              w.versions.push({ version: prior.version, source: prior.source });
              w.version = prior.version + 1;
            }
          }
          list[index] = record;
        } else {
          if (p.expectedRevision !== undefined && p.expectedRevision !== 0)
            throw new Error("Revision conflict: resource does not exist");
          record.revision = 1;
          if (method === "widget.save") {
            (record as WidgetRecord).version = 1;
            (record as WidgetRecord).versions = [];
          }
          list.push(record);
        }
        result = record;
        break;
      }
      case "asset.save": {
        const record = clone(p.record) as AssetRecord;
        findPage(record.pageId);
        const index = state.assets.findIndex((x) => x.id === record.id);
        if (index >= 0) {
          if (state.assets[index].pageId !== record.pageId)
            throw new Error("Cannot move asset between pages");
          state.assets[index] = record;
        } else state.assets.push(record);
        result = record;
        break;
      }
      case "asset.remove": {
        state.assets = state.assets.filter((x) => x.id !== p.id);
        for (const page of state.pages) {
          let changed = false;
          for (const block of flattenBlocks(page.blocks))
            if (block.props.assetId === p.id) {
              delete block.props.assetId;
              changed = true;
            }
          if (changed) touch(page);
        }
        break;
      }
      case "suggestion.upsert": {
        if (!Array.isArray(p.suggestions))
          throw new Error("Suggestions required");
        let count = 0;
        for (const incoming of p.suggestions as SourceSuggestion[]) {
          const existing = state.suggestions.find(
            (x) =>
              x.id === incoming.id ||
              (x.connectionId === incoming.connectionId &&
                x.candidateKey === incoming.candidateKey),
          );
          if (existing) {
            if (existing.connectionId !== incoming.connectionId)
              throw new Error("Suggestion ID belongs to another connection");
            const saved = {
              id: existing.id,
              status: existing.status,
              pageId: existing.pageId,
            };
            Object.assign(existing, clone(incoming), saved);
          } else {
            state.suggestions.push({
              ...clone(incoming),
              status: "pending",
              pageId: undefined,
            });
            count++;
          }
        }
        result = count;
        break;
      }
      case "suggestion.accept": {
        const suggestion = state.suggestions.find((x) => x.id === p.id);
        if (!suggestion) throw new Error("Suggestion not found");
        if (suggestion.status === "accepted") {
          if (!suggestion.pageId)
            throw new Error("Previously accepted page has been removed");
          result = findPage(suggestion.pageId);
          break;
        }
        if (suggestion.status === "dismissed")
          throw new Error("Suggestion was dismissed");
        validateDate(p.date);
        let page: Page;
        if (p.updatePageId) {
          page = findPage(p.updatePageId);
          assertRevision(page, p.expectedRevision);
          page.deadline = clone(p.date);
          if (p.title !== undefined) page.title = p.title;
          touch(page);
          historyPage = page.id;
        } else {
          page = newPage({
            title: p.title ?? suggestion.title,
            deadline: clone(p.date),
          });
          state.pages.push(page);
        }
        suggestion.status = "accepted";
        suggestion.pageId = page.id;
        result = page;
        break;
      }
      case "suggestion.dismiss": {
        const suggestion = state.suggestions.find((x) => x.id === p.id);
        if (!suggestion) throw new Error("Suggestion not found");
        if (suggestion.status !== "accepted") suggestion.status = "dismissed";
        break;
      }
      case "connection.save": {
        const record = clone(p.record) as Connection;
        const index = state.connections.findIndex((x) => x.id === record.id);
        if (index >= 0) state.connections[index] = record;
        else state.connections.push(record);
        result = record;
        break;
      }
      case "connection.remove": {
        state.connections = state.connections.filter((x) => x.id !== p.id);
        state.suggestions = state.suggestions.filter(
          (x) => x.connectionId !== p.id,
        );
        state.importedEvents = state.importedEvents.filter(
          (x) => x.connectionId !== p.id,
        );
        break;
      }
      case "calendar.import": {
        if (!state.connections.some((c) => c.id === p.connectionId))
          throw new Error("Connection not found");
        if (
          !Array.isArray(p.events) ||
          p.events.some((e: any) => e.connectionId !== p.connectionId)
        )
          throw new Error("Invalid imported events");
        state.importedEvents = [
          ...state.importedEvents.filter(
            (x) => x.connectionId !== p.connectionId,
          ),
          ...clone(p.events),
        ];
        break;
      }
      case "settings.update": {
        Object.assign(
          state.settings,
          pick(p.changes ?? {}, [
            "view",
            "sidebarExpanded",
            "textScale",
            "calendarView",
            "weekStartsOn",
            "backupEnabled",
            "backupPath",
            "backupLastAt",
            "reducedMotion",
            "onboardingDismissed",
          ]),
        );
        result = state.settings;
        break;
      }
      default:
        throw new Error(`Unknown planner method: ${method}`);
    }
    validateWorkspace(state);
    if (historyPage) {
      const changes = changesBetween(before, state);
      if (changes.length)
        history.push({
          id: uuid(),
          pageId: historyPage,
          method,
          changes,
          undone: false,
        });
    }
    if (this.repository.commitSnapshot)
      this.repository.commitSnapshot(state, history);
    else {
      this.repository.replaceSnapshot(state);
      this.volatileHistory = history;
    }
    return clone(result);
  }
}
