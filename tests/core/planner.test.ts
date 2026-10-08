import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  EncryptedRepository,
  encryptPayload,
  decryptPayload,
} from "../../src/core/repository";
import { PlannerService } from "../../src/core/service";
import {
  createEmptyWorkspace,
  getCalendarOccurrences,
  getFocusGroups,
} from "../../src/core/domain";
import type {
  Page,
  CalendarEntry,
  WorkspaceSnapshot,
  SourceSuggestion,
} from "../../src/shared/types";
let dir: string, db: EncryptedRepository, service: PlannerService;
const key = Buffer.alloc(32, 7),
  date = (date: string, time?: string, timeZone = "Asia/Shanghai") => ({
    date,
    ...(time ? { time } : {}),
    timeZone,
  });
const run = <T = any>(
  method: string,
  params: Record<string, unknown> = {},
): T => service.execute(method, params) as T;
const page = (title = "Private essay") => run<Page>("page.create", { title });
const work = (p: Page, day = "2026-10-12", kind = "work", extra = {}) =>
  run<CalendarEntry>("schedule.create", {
    pageId: p.id,
    kind,
    when: date(day),
    ...extra,
  });
const snapshot = () => run<WorkspaceSnapshot>("workspace.get");
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "planner-core-"));
  db = new EncryptedRepository(join(dir, "workspace.db"), key);
  service = new PlannerService(db);
});
afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});
describe("encrypted persistence", () => {
  it("keeps page and unknown block content encrypted across reopen and rejects wrong key", () => {
    const p = run<Page>("page.create", {
      title: "Secret-title-9271",
      blocks: [
        {
          id: "b1",
          type: "future-custom",
          props: { secret: "Hidden-block-6281" },
          content: { unknown: [1, 2] },
        },
      ],
    });
    db.close();
    const bytes = readFileSync(join(dir, "workspace.db"));
    expect(bytes.includes(Buffer.from(p.title))).toBe(false);
    expect(bytes.includes(Buffer.from("Hidden-block-6281"))).toBe(false);
    expect(
      () =>
        new EncryptedRepository(join(dir, "workspace.db"), Buffer.alloc(32, 9)),
    ).toThrow();
    db = new EncryptedRepository(join(dir, "workspace.db"), key);
    expect(db.getSnapshot().pages[0]).toEqual(p);
  });
  it("refuses incompatible schema without modifying the database", () => {
    db.close();
    const raw = new Database(join(dir, "workspace.db"));
    raw.pragma("user_version = 99");
    raw.close();
    const before = readFileSync(join(dir, "workspace.db"));
    expect(
      () => new EncryptedRepository(join(dir, "workspace.db"), key),
    ).toThrow(/schema|version/i);
    expect(readFileSync(join(dir, "workspace.db"))).toEqual(before);
  });
  it("rejects invalid restore without replacing current content", () => {
    const p = page();
    const bad = createEmptyWorkspace();
    bad.pages = [{ ...p, parentId: "missing" }];
    expect(() => run("workspace.import", { snapshot: bad })).toThrow();
    expect(snapshot().pages[0].id).toBe(p.id);
  });
});
describe("page transactions", () => {
  it("checks revisions and atomically completes work while preserving fixed events and unfinished status", () => {
    let p = page();
    const w = work(p);
    const e = work(p, "2026-10-12", "event");
    expect(() =>
      run("page.update", {
        id: p.id,
        expectedRevision: 0,
        changes: { title: "stale" },
      }),
    ).toThrow(/revision|conflict/i);
    p = run("page.complete", { id: p.id, expectedRevision: p.revision });
    expect(p.status).toBe("completed");
    expect(snapshot().entries.find((x) => x.id === w.id)).toMatchObject({
      active: false,
      status: "planned",
    });
    expect(snapshot().entries.find((x) => x.id === e.id)?.active).toBe(true);
  });
  it("undo restores only affected records and survives reopening", () => {
    const p = page(),
      other = page("Other");
    work(p);
    run("page.complete", { id: p.id, expectedRevision: p.revision });
    run("page.update", {
      id: other.id,
      expectedRevision: other.revision,
      changes: { title: "Edited other" },
    });
    db.close();
    db = new EncryptedRepository(join(dir, "workspace.db"), key);
    service = new PlannerService(db);
    expect(run<Page>("page.undo", { id: p.id }).status).toBe("active");
    expect(snapshot().entries[0].active).toBe(true);
    expect(snapshot().pages.find((x) => x.id === other.id)?.title).toBe(
      "Edited other",
    );
  });
  it("undo refuses to overwrite subsequently edited entries", () => {
    const p = page(),
      w = work(p);
    run("page.complete", { id: p.id, expectedRevision: p.revision });
    const changed = snapshot().entries[0];
    run("schedule.update", {
      id: w.id,
      expectedRevision: changed.revision,
      changes: { title: "Later edit" },
    });
    expect(() => run("page.undo", { id: p.id })).toThrow(/conflict|revision/i);
    expect(snapshot().entries[0].title).toBe("Later edit");
  });
  it("patch preserves unknown blocks, rejects missing targets and deactivates linked removed blocks", () => {
    let p = run<Page>("page.create", {
      blocks: [
        { id: "unknown", type: "future", props: { x: 3 } },
        { id: "check", type: "checkListItem", props: { checked: false } },
      ],
    });
    work(p, "2026-10-12", "work", { blockId: "check" });
    expect(() =>
      run("page.patch", {
        id: p.id,
        expectedRevision: p.revision,
        operations: [{ type: "update", id: "missing", changes: { props: {} } }],
      }),
    ).toThrow();
    p = run("page.patch", {
      id: p.id,
      expectedRevision: p.revision,
      operations: [{ type: "delete", id: "check" }],
    });
    expect(p.blocks).toEqual([
      { id: "unknown", type: "future", props: { x: 3 } },
    ]);
    expect(snapshot().entries[0].active).toBe(false);
    expect(() =>
      work(p, "2026-10-12", "work", { blockId: "missing" }),
    ).toThrow();
  });
  it("trash restore remembers prior status and entries; purge requires trash and clears references", () => {
    const p = page(),
      w = work(p);
    expect(() => run("page.purge", { id: p.id })).toThrow();
    let t = run<Page>("page.delete", {
      id: p.id,
      expectedRevision: p.revision,
    });
    expect(snapshot().entries[0].active).toBe(false);
    t = run("page.restore", { id: p.id, expectedRevision: t.revision });
    expect(t.status).toBe("active");
    expect(snapshot().entries.find((x) => x.id === w.id)?.active).toBe(true);
    run("page.delete", { id: p.id, expectedRevision: t.revision });
    run("page.purge", { id: p.id });
    expect(snapshot().pages).toHaveLength(0);
    expect(snapshot().entries).toHaveLength(0);
  });
  it("duplicates study/widget resources with remapped block IDs and reset practice", () => {
    let p = run<Page>("page.create", { deadline: date("2026-10-15") });
    run("study.save", {
      record: {
        id: "s1",
        pageId: p.id,
        kind: "flashcards",
        title: "Cards",
        cards: [
          {
            id: "c1",
            front: "F",
            back: "B",
            review: "got-it",
            reviewedAt: "2026-10-06T00:00:00Z",
          },
        ],
        questions: [],
        attempts: [{ id: "a1", at: "2026-10-07T00:00:00Z", answers: {} }],
        revision: 0,
      },
    });
    p = run("page.patch", {
      id: p.id,
      expectedRevision: p.revision,
      operations: [
        {
          type: "insert",
          block: {
            id: "studyblock",
            type: "flashcards",
            props: { studyId: "s1" },
          },
        },
      ],
    });
    const duplicate = run<Page>("page.duplicate", {
      id: p.id,
      asTemplate: true,
    });
    expect(duplicate.deadline).toBeNull();
    expect(duplicate.isTemplate).toBe(true);
    expect(duplicate.blocks[0].id).not.toBe("studyblock");
    const study = snapshot().studies.find((s) => s.pageId === duplicate.id)!;
    expect(study.id).not.toBe("s1");
    expect(duplicate.blocks[0].props.studyId).toBe(study.id);
    expect(study.cards[0].review).toBeUndefined();
    expect(study.attempts).toEqual([]);
    expect(run<Page>("page.instantiate", { id: duplicate.id }).isTemplate).toBe(
      false,
    );
  });
});
describe("calendar and Focus", () => {
  it("moving a session never changes the deadline", () => {
    const p = run<Page>("page.create", { deadline: date("2026-10-15") }),
      w = work(p);
    run("schedule.move", {
      id: w.id,
      expectedRevision: w.revision,
      when: date("2026-10-13"),
    });
    expect(snapshot().pages[0].deadline?.date).toBe("2026-10-15");
    expect(
      getCalendarOccurrences(snapshot(), "2026-10-13", "2026-10-15")
        .map((x) => x.kind)
        .sort(),
    ).toEqual(["deadline", "work"]);
  });
  it("tracks weekly status and moved-in exceptions by their original date", () => {
    const p = page();
    let w = work(p, "2026-10-05", "work", { repeat: { frequency: "weekly" } });
    w = run("schedule.status", {
      id: w.id,
      expectedRevision: w.revision,
      status: "done",
      occurrenceDate: "2026-10-05",
    });
    w = run("schedule.move", {
      id: w.id,
      expectedRevision: w.revision,
      scope: "one",
      occurrenceDate: "2026-10-12",
      when: date("2026-11-02"),
    });
    const oct = getCalendarOccurrences(snapshot(), "2026-10-05", "2026-10-12");
    expect(oct).toHaveLength(1);
    expect(oct[0].status).toBe("done");
    const nov = getCalendarOccurrences(snapshot(), "2026-11-02", "2026-11-02");
    expect(nov).toHaveLength(2);
    expect(nov.some((x) => x.id === `${w.id}@2026-10-12`)).toBe(true);
  });
  it("splits future series without changing past occurrences", () => {
    const p = page();
    let w = work(p, "2026-10-05", "work", { repeat: { frequency: "weekly" } });
    run("schedule.move", {
      id: w.id,
      expectedRevision: w.revision,
      scope: "future",
      occurrenceDate: "2026-10-19",
      when: date("2026-10-20", "10:00"),
    });
    const all = getCalendarOccurrences(snapshot(), "2026-10-05", "2026-10-27");
    expect(all.map((x) => x.when.date)).toEqual([
      "2026-10-05",
      "2026-10-12",
      "2026-10-20",
      "2026-10-27",
    ]);
  });
  it("preserves IANA wall time across DST and rejects nonexistent local times", () => {
    const p = page();
    work(p, "2026-10-25", "event", {
      when: date("2026-10-25", "09:00", "America/New_York"),
      repeat: { frequency: "weekly" },
    });
    expect(
      getCalendarOccurrences(snapshot(), "2026-10-25", "2026-11-01").map(
        (x) => x.when.time,
      ),
    ).toEqual(["09:00", "09:00"]);
    expect(() =>
      work(p, "2026-03-08", "event", {
        when: date("2026-03-08", "02:30", "America/New_York"),
      }),
    ).toThrow();
  });
  it("Focus deduplicates by precedence, includes old missed work, and treats date-only end-of-day correctly", () => {
    const due = run<Page>("page.create", {
      title: "Due",
      deadline: date("2026-10-07"),
    });
    const missed = page("Missed");
    work(missed, "2026-09-01");
    run("page.update", {
      id: missed.id,
      expectedRevision: missed.revision,
      changes: { pinned: true },
    });
    const pinned = page("Pin");
    run("page.update", {
      id: pinned.id,
      expectedRevision: pinned.revision,
      changes: { pinned: true },
    });
    const future = page("Future");
    work(future, "2026-10-14", "event");
    const distant = page("Distant");
    work(distant, "2026-10-15", "event");
    const groups = getFocusGroups(
      snapshot(),
      "2026-10-07",
      "2026-10-07T04:00:00Z",
    );
    expect(groups.attention.map((x) => x.id)).toEqual([missed.id]);
    expect(groups.pinned.map((x) => x.id)).toEqual([pinned.id]);
    expect(groups.today.map((x) => x.id)).toEqual([due.id]);
    expect(groups.upcoming.map((x) => x.id)).toEqual([future.id]);
    expect(
      getFocusGroups(
        snapshot(),
        "2026-10-08",
        "2026-10-08T00:00:00Z",
      ).attention.map((x) => x.id),
    ).toContain(due.id);
  });
});
describe("resources and source review", () => {
  const suggestion = (overrides = {}) =>
    ({
      id: "sug1",
      connectionId: "con1",
      providerMessageId: "msg1",
      candidateKey: "candidate1",
      title: "Essay",
      excerpt: "Due soon",
      date: date("2026-10-15"),
      ambiguous: false,
      status: "pending",
      sourceUrl: "https://example.test/message",
      ...overrides,
    }) as SourceSuggestion;
  beforeEach(() => {
    run("connection.save", {
      record: {
        id: "con1",
        provider: "google",
        accountName: "Account",
        status: "connected",
        settings: {},
      },
    });
  });
  it("preserves accepted/dismissed dedup and requires reviewed update revision", () => {
    run("suggestion.upsert", { suggestions: [suggestion()] });
    const p = run<Page>("suggestion.accept", {
      id: "sug1",
      date: date("2026-10-16"),
    });
    run("suggestion.upsert", { suggestions: [suggestion({ id: "otherid" })] });
    expect(snapshot().suggestions).toHaveLength(1);
    expect(snapshot().suggestions[0].status).toBe("accepted");
    run("suggestion.upsert", {
      suggestions: [
        suggestion({
          id: "follow",
          candidateKey: "follow",
          possibleUpdatePageId: p.id,
        }),
      ],
    });
    expect(() =>
      run("suggestion.accept", {
        id: "follow",
        date: date("2026-10-18"),
        updatePageId: p.id,
      }),
    ).toThrow();
    run("suggestion.accept", {
      id: "follow",
      date: date("2026-10-18"),
      updatePageId: p.id,
      expectedRevision: p.revision,
    });
    expect(snapshot().pages).toHaveLength(1);
    expect(snapshot().pages[0].deadline?.date).toBe("2026-10-18");
    run("suggestion.upsert", {
      suggestions: [suggestion({ id: "dismiss", candidateKey: "dismiss" })],
    });
    run("suggestion.dismiss", { id: "dismiss" });
    run("suggestion.upsert", {
      suggestions: [suggestion({ id: "dismiss", candidateKey: "dismiss" })],
    });
    expect(snapshot().suggestions.find((x) => x.id === "dismiss")?.status).toBe(
      "dismissed",
    );
  });
  it("exports content without connections/source caches, validates referenced resources, and keeps accepted pages after disconnect", () => {
    run("suggestion.upsert", { suggestions: [suggestion()] });
    const p = run<Page>("suggestion.accept", {
      id: "sug1",
      date: date("2026-10-16"),
    });
    run("calendar.import", {
      connectionId: "con1",
      events: [
        {
          id: "imp",
          connectionId: "con1",
          calendarId: "cal",
          title: "Source",
          when: date("2026-10-08"),
        },
      ],
    });
    const exported = run<WorkspaceSnapshot>("workspace.export");
    expect(exported.connections).toEqual([]);
    expect(exported.suggestions).toEqual([]);
    expect(exported.importedEvents).toEqual([]);
    expect(exported.pages[0].id).toBe(p.id);
    const bad = structuredClone(exported);
    bad.pages[0].blocks = [
      { id: "widgetb", type: "widget", props: { widgetId: "missing" } },
    ];
    expect(() => run("workspace.import", { snapshot: bad })).toThrow();
    run("connection.remove", { id: "con1" });
    expect(snapshot().pages[0].id).toBe(p.id);
    expect(snapshot().importedEvents).toEqual([]);
  });
  it("saves revisions and widget source versions and rejects stale writes", () => {
    const p = page();
    const record = {
      id: "widget",
      pageId: p.id,
      title: "Tool",
      source: "first",
      state: { x: 1 },
      version: 1,
      versions: [],
      revision: 0,
    };
    const saved = run("widget.save", { record });
    expect(saved.revision).toBe(1);
    const changed = run("widget.save", {
      record: { ...saved, source: "second" },
      expectedRevision: 1,
    });
    expect(changed.revision).toBe(2);
    expect(changed.versions).toContainEqual({ version: 1, source: "first" });
    expect(() => run("widget.save", { record, expectedRevision: 1 })).toThrow();
    db.close();
    db = new EncryptedRepository(join(dir, "workspace.db"), key);
    expect(db.getSnapshot().widgets[0].state).toEqual({ x: 1 });
  });
});
describe("validation and utility commands", () => {
  it("keeps unrelated work done state when completing and restores opt-in reminders on undo", () => {
    const p = page();
    let w = work(p, "2026-10-01", "work", {
      reminder: { enabled: true, beforeMinutes: 10 },
    });
    w = run("schedule.status", {
      id: w.id,
      expectedRevision: w.revision,
      status: "done",
    });
    run("page.complete", { id: p.id, expectedRevision: p.revision });
    expect(snapshot().entries[0].active).toBe(true);
    expect(snapshot().entries[0].reminder?.enabled).toBe(false);
    run("page.undo", { id: p.id });
    expect(snapshot().entries[0].reminder?.enabled).toBe(true);
  });
  it("includes a missed repeat exception moved before the series start", () => {
    const p = page();
    let w = work(p, "2026-10-19", "work", { repeat: { frequency: "weekly" } });
    run("schedule.move", {
      id: w.id,
      expectedRevision: w.revision,
      scope: "one",
      occurrenceDate: "2026-10-19",
      when: date("2026-10-01"),
    });
    expect(
      getFocusGroups(
        snapshot(),
        "2026-10-07",
        "2026-10-07T04:00:00Z",
      ).attention.map((x) => x.id),
    ).toEqual([p.id]);
  });
  it("rejects malformed imported field types without persisting them", () => {
    const p = page();
    const bad = snapshot();
    (bad.pages[0] as any).createdAt = 12;
    expect(() => run("workspace.import", { snapshot: bad })).toThrow();
    expect(snapshot().pages[0].createdAt).toEqual(p.createdAt);
    expect(() => work(p, "2026-10-08", "work", { endTime: "99:77" })).toThrow();
    expect(() =>
      run("settings.update", { changes: { backupEnabled: "yes" } }),
    ).toThrow();
    expect(() =>
      run("page.update", {
        id: p.id,
        expectedRevision: p.revision,
        changes: { reminder: { enabled: true, beforeMinutes: -1 } },
      }),
    ).toThrow();
  });
  it("rejects reminder windows that would expand unbounded recurring calendars", () => {
    const p=page();expect(()=>run("page.update",{id:p.id,expectedRevision:p.revision,changes:{reminder:{enabled:true,beforeMinutes:100000000}}})).toThrow("Invalid reminder");expect(snapshot().pages[0].reminder).toBeUndefined();
  });
  it("rejects fixed offset and system zones in persisted dates", () => {
    const p = page();
    expect(() =>
      work(p, "2026-10-08", "work", {
        when: date("2026-10-08", "10:00", "UTC+8"),
      }),
    ).toThrow();
    expect(() =>
      work(p, "2026-10-08", "work", {
        when: date("2026-10-08", "10:00", "local"),
      }),
    ).toThrow();
  });
  it("moves recurring future bounds and exceptions by the same week offset", () => {
    const p = page();
    const w = work(p, "2026-10-05", "work", {
      repeat: { frequency: "weekly", until: "2026-10-19" },
    });
    run("schedule.move", {
      id: w.id,
      expectedRevision: w.revision,
      occurrenceDate: "2026-10-12",
      scope: "future",
      when: date("2026-10-13"),
    });
    expect(
      getCalendarOccurrences(snapshot(), "2026-10-05", "2026-10-21").map(
        (x) => x.when.date,
      ),
    ).toEqual(["2026-10-05", "2026-10-13", "2026-10-20"]);
  });
  it("supports block insertion/update, nested deletion, label lifecycle, and safe asset removal", () => {
    const label = run("label.create", { name: " Physics " });
    let p = run<Page>("page.create", {
      labels: [label.id],
      blocks: [
        {
          id: "parent",
          type: "toggleListItem",
          props: {},
          children: [
            {
              id: "child",
              type: "paragraph",
              props: { color: "red" },
              content: "Old",
            },
          ],
        },
      ],
    });
    p = run("page.patch", {
      id: p.id,
      expectedRevision: p.revision,
      operations: [
        { type: "update", id: "child", changes: { content: "New" } },
        {
          type: "insert",
          parentId: "parent",
          afterId: "child",
          block: { id: "next", type: "paragraph", props: {} },
        },
      ],
    });
    expect(p.blocks[0].children?.[0]).toMatchObject({
      props: { color: "red" },
      content: "New",
    });
    expect(p.blocks[0].children?.map((x) => x.id)).toEqual(["child", "next"]);
    run("label.update", {
      id: label.id,
      name: "Mathematics",
      color: "#888888",
    });
    expect(snapshot().labels[0].name).toBe("Mathematics");
    run("label.delete", { id: label.id });
    p = snapshot().pages[0];
    expect(p.labels).toEqual([]);
    run("asset.save", {
      record: {
        id: "asset1",
        pageId: p.id,
        name: "a.txt",
        kind: "file-link",
        mime: "text/plain",
        size: 10,
        originalPath: "/tmp/a.txt",
      },
    });
    p = run("page.patch", {
      id: p.id,
      expectedRevision: p.revision,
      operations: [
        {
          type: "insert",
          block: { id: "file", type: "file", props: { assetId: "asset1" } },
        },
      ],
    });
    run("asset.remove", { id: "asset1" });
    expect(
      snapshot().pages[0].blocks.find((b) => b.id === "file")?.props.assetId,
    ).toBeUndefined();
  });
  it("persists study progress with conflict checks and removes schedule entries explicitly", () => {
    const p = page();
    const record = {
      id: "study",
      pageId: p.id,
      title: "Quiz",
      kind: "quiz",
      cards: [],
      questions: [
        { id: "q1", prompt: "1+1", type: "short-answer", answer: "2" },
      ],
      attempts: [],
      revision: 0,
    };
    let study = run("study.save", { record });
    study = run("study.save", {
      record: {
        ...study,
        attempts: [
          {
            id: "attempt1",
            at: "2026-10-07T00:00:00Z",
            answers: { q1: "2" },
            score: 1,
          },
        ],
      },
      expectedRevision: study.revision,
    });
    expect(study.revision).toBe(2);
    expect(() => run("study.save", { record, expectedRevision: 1 })).toThrow();
    const w = work(p);
    expect(() =>
      run("schedule.remove", { id: w.id, expectedRevision: 0 }),
    ).toThrow();
    run("schedule.remove", { id: w.id, expectedRevision: w.revision });
    expect(snapshot().entries).toEqual([]);
    db.close();
    db = new EncryptedRepository(join(dir, "workspace.db"), key);
    expect(db.getSnapshot().studies[0].attempts[0].score).toBe(1);
  });
  it("archive keeps event history and multiple undo steps preserve monotonic revisions", () => {
    let p = page();
    work(p, "2026-10-01", "event");
    p = run("page.update", {
      id: p.id,
      expectedRevision: p.revision,
      changes: { title: "Edit 1" },
    });
    p = run("page.update", {
      id: p.id,
      expectedRevision: p.revision,
      changes: { title: "Edit 2" },
    });
    p = run("page.undo", { id: p.id });
    expect(p.title).toBe("Edit 1");
    expect(p.revision).toBe(4);
    p = run("page.undo", { id: p.id });
    expect(p.title).toBe("Private essay");
    expect(p.revision).toBe(5);
    p = run("page.archive", { id: p.id, expectedRevision: p.revision });
    expect(
      getCalendarOccurrences(snapshot(), "2026-10-01", "2026-10-01"),
    ).toHaveLength(1);
    expect(
      getFocusGroups(snapshot(), "2026-10-07", "2026-10-07T00:00:00Z"),
    ).toEqual({ attention: [], pinned: [], today: [], upcoming: [] });
  });
  it("rolls back graph and undo history together when validation fails mid-patch", () => {
    const p = run<Page>("page.create", {
      blocks: [{ id: "b1", type: "paragraph", props: {} }],
    });
    expect(() =>
      run("page.patch", {
        id: p.id,
        expectedRevision: p.revision,
        operations: [
          { type: "delete", id: "b1" },
          { type: "delete", id: "missing" },
        ],
      }),
    ).toThrow();
    expect(snapshot().pages[0]).toEqual(p);
    expect(() => run("page.undo", { id: p.id })).toThrow(/No page changes/);
  });
});

describe("storage integrity and graph references", () => {
  it("authenticates encrypted asset bytes and produces a fresh nonce each time", () => {
    const bytes = Buffer.from("Private asset bytes");
    const first = encryptPayload(bytes, key),
      second = encryptPayload(bytes, key);
    expect(first.equals(second)).toBe(false);
    expect(decryptPayload(first, key)).toEqual(bytes);
    const tampered = Buffer.from(first);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptPayload(tampered, key)).toThrow();
    expect(() => encryptPayload(bytes, Buffer.alloc(8))).toThrow();
  });
  it("creates a recoverable byte-identical backup before a schema upgrade", () => {
    page();
    db.close();
    const raw = new Database(join(dir, "workspace.db"));
    raw.pragma("user_version = 0");
    raw.close();
    const original = readFileSync(join(dir, "workspace.db"));
    db = new EncryptedRepository(join(dir, "workspace.db"), key);
    const backup = readdirSync(dir).find((n) => n.includes(".pre-migration-"))!;
    expect(backup).toBeTruthy();
    expect(readFileSync(join(dir, backup))).toEqual(original);
    expect(db.getSnapshot().pages[0].title).toBe("Private essay");
  });
  it("validates nested resource IDs and study answer targets before restore", () => {
    const p = page();
    const record = {
      id: "quiz",
      pageId: p.id,
      title: "Quiz",
      kind: "quiz",
      cards: [],
      questions: [
        { id: "q", prompt: "Question", type: "short-answer", answer: "Answer" },
      ],
      attempts: [],
      revision: 0,
    };
    run("study.save", { record });
    const bad = snapshot();
    bad.studies[0].attempts = [
      { id: "a", at: "2026-10-07T00:00:00Z", answers: { missing: "response" } },
    ];
    expect(() => run("workspace.import", { snapshot: bad })).toThrow();
    const missing = snapshot();
    missing.pages[0].blocks = [
      { id: "sub", type: "subpage", props: { subpageId: "nonexistent" } },
    ];
    expect(() => run("workspace.import", { snapshot: missing })).toThrow();
    expect(snapshot().studies[0].attempts).toEqual([]);
  });
  it("refuses an unrelated version-zero SQLite file without adding tables", () => {
    db.close();
    rmSync(join(dir, "workspace.db"));
    const raw = new Database(join(dir, "workspace.db"));
    raw.exec(
      "CREATE TABLE important_data(value TEXT); INSERT INTO important_data VALUES ('original')",
    );
    raw.close();
    const original = readFileSync(join(dir, "workspace.db"));
    expect(
      () => new EncryptedRepository(join(dir, "workspace.db"), key),
    ).toThrow(/schema|unrecognized/i);
    expect(readFileSync(join(dir, "workspace.db"))).toEqual(original);
  });
});

describe("atomic resource creation and portable trash", () => {
  const studyRecord = (pageId: string, id = "atomic-study") => ({
    id,
    pageId,
    kind: "flashcards",
    title: "Cards",
    cards: [
      { id: `${id}-card`, front: "Force", back: "Mass times acceleration" },
    ],
    questions: [],
    attempts: [],
    revision: 0,
  });
  it("inserts a study and its block in one undoable page transaction", () => {
    const p = page();
    const updated = run<Page>("page.resource", {
      pageId: p.id,
      expectedRevision: p.revision,
      kind: "study",
      record: studyRecord(p.id),
      block: {
        id: "atomic-block",
        type: "flashcards",
        props: { studyId: "atomic-study" },
      },
    });
    expect(updated.revision).toBe(2);
    expect(updated.blocks[0].props.studyId).toBe("atomic-study");
    expect(snapshot().studies[0].revision).toBe(1);
    const restored = run<Page>("page.undo", { id: p.id });
    expect(restored.blocks).toEqual([]);
    expect(snapshot().studies).toEqual([]);
  });
  it("rejects a stale resource insertion without leaving an orphan", () => {
    const p = page();
    run("page.update", {
      id: p.id,
      expectedRevision: p.revision,
      changes: { title: "Concurrent edit" },
    });
    expect(() =>
      run("page.resource", {
        pageId: p.id,
        expectedRevision: p.revision,
        kind: "study",
        record: studyRecord(p.id),
        block: {
          id: "atomic-block",
          type: "flashcards",
          props: { studyId: "atomic-study" },
        },
      }),
    ).toThrow(/revision|conflict/i);
    expect(snapshot().studies).toEqual([]);
    expect(snapshot().pages[0].blocks).toEqual([]);
    expect(snapshot().pages[0].title).toBe("Concurrent edit");
  });
  it("inserts a widget atomically and rejects invalid resource links", () => {
    const p = page();
    const record = {
      id: "atomic-widget",
      pageId: p.id,
      title: "Tool",
      source: "<html></html>",
      version: 99,
      versions: [],
      state: {},
      revision: 0,
    };
    expect(() =>
      run("page.resource", {
        pageId: p.id,
        expectedRevision: p.revision,
        kind: "widget",
        record,
        block: {
          id: "wrong-block",
          type: "widget",
          props: { widgetId: "other" },
        },
      }),
    ).toThrow();
    expect(snapshot().widgets).toEqual([]);
    const updated = run<Page>("page.resource", {
      pageId: p.id,
      expectedRevision: p.revision,
      kind: "widget",
      record,
      block: {
        id: "widget-block",
        type: "widget",
        props: { widgetId: "atomic-widget" },
      },
    });
    expect(updated.revision).toBe(2);
    expect(snapshot().widgets[0].version).toBe(1);
    run("page.undo", { id: p.id });
    expect(snapshot().widgets).toEqual([]);
  });
  it("restores trashed work and reminders after a portable export/import", () => {
    let p = page();
    p = run("page.update", {
      id: p.id,
      expectedRevision: p.revision,
      changes: { reminder: { enabled: true, beforeMinutes: 15 } },
    });
    work(p, "2026-10-12", "work", {
      reminder: { enabled: true, beforeMinutes: 5 },
    });
    const trashed = run<Page>("page.delete", {
      id: p.id,
      expectedRevision: p.revision,
    });
    const portable = run<WorkspaceSnapshot>("workspace.export");
    run("workspace.import", { snapshot: portable });
    const restored = run<Page>("page.restore", {
      id: p.id,
      expectedRevision: trashed.revision,
    });
    expect(restored.status).toBe("active");
    expect(restored.reminder?.enabled).toBe(true);
    expect(snapshot().entries[0]).toMatchObject({
      active: true,
      reminder: { enabled: true, beforeMinutes: 5 },
    });
    expect((restored as any).trashState).toBeUndefined();
  });
  it("portable trash retains completed status and refuses later entry edits", () => {
    let p = page();
    const w = work(p);
    p = run("page.complete", { id: p.id, expectedRevision: p.revision });
    p = run("page.delete", { id: p.id, expectedRevision: p.revision });
    run("workspace.import", { snapshot: run("workspace.export") });
    let restored = run<Page>("page.restore", {
      id: p.id,
      expectedRevision: p.revision,
    });
    expect(restored.status).toBe("completed");
    expect(snapshot().entries[0].active).toBe(false);
    restored = run("page.delete", {
      id: p.id,
      expectedRevision: restored.revision,
    });
    run("workspace.import", { snapshot: run("workspace.export") });
    const entry = snapshot().entries[0];
    run("schedule.update", {
      id: w.id,
      expectedRevision: entry.revision,
      changes: { title: "Later entry edit" },
    });
    expect(() =>
      run("page.restore", { id: p.id, expectedRevision: restored.revision }),
    ).toThrow(/revision|conflict/i);
    expect(snapshot().entries[0].title).toBe("Later entry edit");
  });
  it("backs up encrypted SQLite while preserving transaction history", async () => {
    const p = page("Encrypted live backup");
    run("page.complete", { id: p.id, expectedRevision: p.revision });
    const destination = join(dir, "backup.db");
    await (db as any).backupTo(destination);
    expect(
      readFileSync(destination).includes(Buffer.from("Encrypted live backup")),
    ).toBe(false);
    const backup = new EncryptedRepository(destination, key);
    try {
      const restoredService = new PlannerService(backup);
      expect(
        (restoredService.execute("page.undo", { id: p.id }) as Page).status,
      ).toBe("active");
    } finally {
      backup.close();
    }
  });
});

it("rejects malformed portable trash metadata and references atomically", () => {
  let p = page();
  work(p);
  p = run("page.delete", { id: p.id, expectedRevision: p.revision });
  const portable = run<WorkspaceSnapshot>("workspace.export");
  const invalid = structuredClone(portable);
  (invalid.pages[0] as any).trashState.entries[0].id = "missing-entry";
  expect(() => run("workspace.import", { snapshot: invalid })).toThrow();
  (invalid.pages[0] as any).trashState = {
    ...(portable.pages[0] as any).trashState,
    status: "trashed",
  };
  expect(() => run("workspace.import", { snapshot: invalid })).toThrow();
  expect(snapshot().pages[0]).toEqual(p);
});

describe("review regressions", () => {
  it("shifts only a DST-gap weekly occurrence forward and keeps Focus usable", () => {
    const p = page();
    const entry = work(p, "2026-03-01", "work", {
      when: date("2026-03-01", "02:30", "America/New_York"),
      repeat: { frequency: "weekly" },
    });
    const occurrences = getCalendarOccurrences(
      snapshot(),
      "2026-03-01",
      "2026-03-15",
    );
    expect(occurrences.map((o) => [o.when.date, o.when.time])).toEqual([
      ["2026-03-01", "02:30"],
      ["2026-03-08", "03:30"],
      ["2026-03-15", "02:30"],
    ]);
    expect(occurrences[1].id).toBe(`${entry.id}@2026-03-08`);
    expect(() =>
      getFocusGroups(snapshot(), "2026-03-08", "2026-03-08T08:00:00Z"),
    ).not.toThrow();
    expect(
      getFocusGroups(
        snapshot(),
        "2026-03-08",
        "2026-03-08T08:00:00Z",
      ).attention.map((p) => p.id),
    ).toEqual([p.id]);
    expect(snapshot().entries[0].when.time).toBe("02:30");
  });
  it("deactivates a planned weekly exception even when the base status is done, and Undo restores it", () => {
    const p = page();
    let entry = work(p, "2026-10-05", "work", {
      repeat: { frequency: "weekly" },
      reminder: { enabled: true, beforeMinutes: 10 },
    });
    entry = run("schedule.status", {
      id: entry.id,
      expectedRevision: entry.revision,
      status: "done",
    });
    entry = run("schedule.status", {
      id: entry.id,
      expectedRevision: entry.revision,
      status: "planned",
      occurrenceDate: "2026-10-12",
    });
    run("page.complete", { id: p.id, expectedRevision: p.revision });
    expect(snapshot().entries[0]).toMatchObject({
      active: false,
      status: "done",
      exceptions: { "2026-10-12": { status: "planned" } },
      reminder: { enabled: false },
    });
    run("page.undo", { id: p.id });
    expect(snapshot().entries[0]).toEqual({
      ...entry,
      revision: entry.revision + 2,
    });
  });
  it("roundtrips an authenticated empty payload and rejects truncated or damaged envelopes", () => {
    const encrypted = encryptPayload(Buffer.alloc(0), key);
    expect(encrypted).toHaveLength(29);
    expect(decryptPayload(encrypted, key)).toEqual(Buffer.alloc(0));
    expect(() => decryptPayload(encrypted.subarray(0, 28), key)).toThrow();
    const damaged = Buffer.from(encrypted);
    damaged[15] ^= 1;
    expect(() => decryptPayload(damaged, key)).toThrow();
  });
  const malformedStudies: [string, (record: any) => void][] = [
    [
      "numeric card ID",
      (r) => {
        r.cards[0].id = 9;
      },
    ],
    [
      "non-string card front",
      (r) => {
        r.cards[0].front = [];
      },
    ],
    [
      "non-string card back",
      (r) => {
        r.cards[0].back = null;
      },
    ],
    [
      "invalid card review",
      (r) => {
        r.cards[0].review = "mastered";
      },
    ],
    [
      "invalid card timestamp",
      (r) => {
        r.cards[0].reviewedAt = 42;
      },
    ],
    [
      "numeric question ID",
      (r) => {
        r.questions[0].id = 5;
      },
    ],
    [
      "unsupported question type",
      (r) => {
        r.questions[0].type = "essay";
      },
    ],
    [
      "non-string question prompt",
      (r) => {
        r.questions[0].prompt = 42;
      },
    ],
    [
      "non-string question answer",
      (r) => {
        r.questions[0].answer = {};
      },
    ],
    [
      "non-array question choices",
      (r) => {
        r.questions[0].choices = 1;
      },
    ],
    [
      "non-string question choice",
      (r) => {
        r.questions[0].choices = ["A", 2];
      },
    ],
    [
      "non-string question explanation",
      (r) => {
        r.questions[0].explanation = false;
      },
    ],
    [
      "numeric attempt ID",
      (r) => {
        r.attempts[0].id = 9;
      },
    ],
    [
      "invalid attempt timestamp",
      (r) => {
        r.attempts[0].at = {};
      },
    ],
    [
      "array attempt answers",
      (r) => {
        r.attempts[0].answers = [];
      },
    ],
    [
      "non-string attempt answer",
      (r) => {
        r.attempts[0].answers.question = 5;
      },
    ],
    [
      "non-number attempt score",
      (r) => {
        r.attempts[0].score = "1";
      },
    ],
    [
      "non-string study title",
      (r) => {
        r.title = false;
      },
    ],
  ];
  it.each(malformedStudies)(
    "rejects portable study with %s without replacing current data",
    (_, mutate) => {
      const p = page();
      run("study.save", {
        record: {
          id: "review-study",
          pageId: p.id,
          title: "Review",
          kind: "quiz",
          cards: [{ id: "card", front: "F", back: "B" }],
          questions: [
            {
              id: "question",
              type: "multiple-choice",
              prompt: "Q",
              answer: "A",
              choices: ["A", "B"],
            },
          ],
          attempts: [
            {
              id: "attempt",
              at: "2026-10-07T00:00:00Z",
              answers: { question: "A" },
              score: 1,
            },
          ],
          revision: 0,
        },
      });
      const original = snapshot();
      const malformed = structuredClone(original);
      mutate(malformed.studies[0]);
      expect(() => run("workspace.import", { snapshot: malformed })).toThrow();
      expect(snapshot()).toEqual(original);
    },
  );
  it.each([
    [
      "array state",
      (r: any) => {
        r.state = [];
      },
    ],
    [
      "non-string title",
      (r: any) => {
        r.title = 5;
      },
    ],
    [
      "non-string historical source",
      (r: any) => {
        r.versions[0].source = 4;
      },
    ],
    [
      "invalid historical version",
      (r: any) => {
        r.versions[0].version = "1";
      },
    ],
    [
      "null historical entry",
      (r: any) => {
        r.versions[0] = null;
      },
    ],
  ] as [string, (r: any) => void][])(
    "rejects portable widget with %s without replacing current data",
    (_, mutate) => {
      const p = page();
      const first = run("widget.save", {
        record: {
          id: "review-widget",
          pageId: p.id,
          title: "Widget",
          source: "first",
          state: {},
          version: 1,
          versions: [],
          revision: 0,
        },
      });
      run("widget.save", {
        record: { ...first, source: "second" },
        expectedRevision: first.revision,
      });
      const original = snapshot();
      const malformed = structuredClone(original);
      mutate(malformed.widgets[0]);
      expect(() => run("workspace.import", { snapshot: malformed })).toThrow();
      expect(snapshot()).toEqual(original);
    },
  );
});
