import { DateTime, IANAZone } from "luxon";
import type {
  WorkspaceSnapshot,
  CalendarOccurrence,
  Page,
  DateValue,
  CalendarEntry,
  PageBlock,
} from "../shared/types";

export function createEmptyWorkspace(): WorkspaceSnapshot {
  return {
    schemaVersion: 1,
    pages: [],
    entries: [],
    labels: [],
    studies: [],
    widgets: [],
    assets: [],
    suggestions: [],
    connections: [],
    importedEvents: [],
    settings: {
      view: "calendar",
      sidebarExpanded: false,
      textScale: 1,
      calendarView: "month",
      weekStartsOn: 1,
      backupEnabled: false,
      reducedMotion: false,
      onboardingDismissed: false,
    },
  };
}
export function assertDateString(date: unknown): asserts date is string {
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !DateTime.fromISO(date, { zone: "UTC" }).isValid
  )
    throw new Error("Invalid calendar date");
}
export function validateDate(value: unknown): asserts value is DateValue {
  const v = value as DateValue;
  if (!v || typeof v !== "object") throw new Error("Invalid date value");
  assertDateString(v.date);
  if (
    typeof v.timeZone !== "string" ||
    !v.timeZone ||
    !IANAZone.isValidZone(v.timeZone)
  )
    throw new Error("Invalid IANA time zone");
  if (
    v.time !== undefined &&
    (!/^\d{2}:\d{2}$/.test(v.time) ||
      !DateTime.fromISO(`${v.date}T${v.time}`, { zone: v.timeZone }).isValid ||
      DateTime.fromISO(`${v.date}T${v.time}`, { zone: v.timeZone }).toFormat(
        "yyyy-MM-dd HH:mm",
      ) !== `${v.date} ${v.time}`)
  )
    throw new Error("Invalid or nonexistent local time");
}
/** Ambiguous fall-back times consistently select the earlier matching instant. */
export function dateValueMillis(value: DateValue, endOfDay = false): number {
  validateDate(value);
  let local = DateTime.fromISO(`${value.date}T${value.time ?? "00:00"}`, {
    zone: value.timeZone,
  });
  if (value.time)
    local = local
      .getPossibleOffsets()
      .sort((a, b) => a.toMillis() - b.toMillis())[0];
  else if (endOfDay) local = local.endOf("day");
  return local.toMillis();
}
export function addDays(date: string, days: number): string {
  assertDateString(date);
  return DateTime.fromISO(date, { zone: "UTC" }).plus({ days }).toISODate()!;
}
export function flattenBlocks(blocks: PageBlock[]): PageBlock[] {
  return blocks.flatMap((b) => [b, ...flattenBlocks(b.children ?? [])]);
}
export function isSeriesDate(entry: CalendarEntry, date: string): boolean {
  assertDateString(date);
  if (!entry.repeat) return date === entry.when.date;
  const distance = DateTime.fromISO(date, { zone: "UTC" }).diff(
    DateTime.fromISO(entry.when.date, { zone: "UTC" }),
    "days",
  ).days;
  return (
    distance >= 0 &&
    distance % 7 === 0 &&
    (!entry.repeat.until || date <= entry.repeat.until)
  );
}
/** Generated weekly occurrences in a DST gap move forward by that gap (02:30 becomes 03:30 for a one-hour gap). The stored series wall time and later weeks remain unchanged. */
function recurringDate(when: DateValue, date: string): DateValue {
  if (!when.time) return { ...when, date };
  const resolved = DateTime.fromISO(`${date}T${when.time}`, {
    zone: when.timeZone,
  });
  if (!resolved.isValid) throw new Error("Invalid recurrence time");
  return {
    ...when,
    date: resolved.toISODate()!,
    time: resolved.toFormat("HH:mm"),
  };
}
export function getCalendarOccurrences(
  snapshot: WorkspaceSnapshot,
  fromDate: string,
  toDate: string,
): CalendarOccurrence[] {
  assertDateString(fromDate);
  assertDateString(toDate);
  if (fromDate > toDate) throw new Error("Invalid calendar range");
  const pages = new Map(snapshot.pages.map((p) => [p.id, p]));
  const result: CalendarOccurrence[] = [];
  const inside = (d: string) => d >= fromDate && d <= toDate;
  for (const p of snapshot.pages) {
    if (
      p.status === "trashed" ||
      p.isTemplate ||
      !p.deadline ||
      !inside(p.deadline.date)
    )
      continue;
    result.push({
      id: `deadline:${p.id}`,
      entryId: `deadline:${p.id}`,
      pageId: p.id,
      title: p.title,
      kind: "deadline",
      when: p.deadline,
      status: p.status === "completed" ? "done" : "planned",
      active: p.status !== "completed",
      recurring: false,
      occurrenceDate: p.deadline.date,
    });
  }
  for (const e of snapshot.entries) {
    const p = pages.get(e.pageId);
    if (!p || p.status === "trashed" || p.isTemplate) continue;
    const dates = new Set<string>();
    if (e.repeat) {
      const delta = DateTime.fromISO(fromDate, { zone: "UTC" }).diff(
        DateTime.fromISO(e.when.date, { zone: "UTC" }),
        "days",
      ).days;
      let cursor = addDays(e.when.date, Math.max(0, Math.ceil(delta / 7)) * 7);
      const end =
        e.repeat.until && e.repeat.until < toDate ? e.repeat.until : toDate;
      for (
        let count = 0;
        cursor <= end && count < 20000;
        count++, cursor = addDays(cursor, 7)
      )
        dates.add(cursor);
      for (const original of Object.keys(e.exceptions))
        if (isSeriesDate(e, original)) dates.add(original);
    } else dates.add(e.when.date);
    for (const original of dates) {
      const exception = e.exceptions[original];
      const when =
        exception?.when ??
        (e.repeat
          ? recurringDate(e.when, original)
          : { ...e.when, date: original });
      if (!inside(when.date)) continue;
      result.push({
        id: e.repeat ? `${e.id}@${original}` : e.id,
        entryId: e.id,
        pageId: e.pageId,
        blockId: e.blockId,
        title: e.title ?? p.title,
        kind: e.kind,
        when,
        endTime: exception?.endTime ?? e.endTime,
        status: exception?.status ?? e.status,
        active: e.active,
        recurring: !!e.repeat,
        occurrenceDate: original,
      });
    }
  }
  return result.sort(
    (a, b) =>
      a.when.date.localeCompare(b.when.date) ||
      (a.when.time ?? "").localeCompare(b.when.time ?? "") ||
      a.id.localeCompare(b.id),
  );
}
export function getFocusGroups(
  snapshot: WorkspaceSnapshot,
  todayDate: string,
  nowISO?: string,
): { attention: Page[]; pinned: Page[]; today: Page[]; upcoming: Page[] } {
  assertDateString(todayDate);
  const now = nowISO
    ? DateTime.fromISO(nowISO).toMillis()
    : DateTime.now().toMillis();
  if (!Number.isFinite(now)) throw new Error("Invalid current time");
  const horizon = addDays(todayDate, 7);
  const first = snapshot.entries
    .flatMap((e) => [
      e.when.date,
      ...Object.values(e.exceptions).flatMap((x) =>
        x.when ? [x.when.date] : [],
      ),
    ])
    .reduce((a, b) => (a < b ? a : b), todayDate);
  const occurrences = getCalendarOccurrences(snapshot, first, horizon);
  const groups: {
    attention: Page[];
    pinned: Page[];
    today: Page[];
    upcoming: Page[];
  } = { attention: [], pinned: [], today: [], upcoming: [] };
  const times = new Map<string, number>();
  for (const p of snapshot.pages) {
    if (p.status !== "active" || p.isTemplate) continue;
    const relevant = occurrences.filter(
      (o) => o.pageId === p.id && o.active && o.status === "planned",
    );
    const overdue =
      !!p.deadline && dateValueMillis(p.deadline, !p.deadline.time) < now;
    const missed = relevant.some(
      (o) => o.kind === "work" && dateValueMillis(o.when, !o.when.time) < now,
    );
    const future = relevant.filter(
      (o) => o.when.date >= todayDate && o.when.date <= horizon,
    );
    times.set(
      p.id,
      Math.min(
        ...relevant.map((o) => dateValueMillis(o.when)),
        p.deadline ? dateValueMillis(p.deadline) : Infinity,
      ),
    );
    if (overdue || missed) groups.attention.push(p);
    else if (p.pinned) groups.pinned.push(p);
    else if (future.some((o) => o.when.date === todayDate))
      groups.today.push(p);
    else if (future.length) groups.upcoming.push(p);
  }
  for (const name of ["attention", "today", "upcoming"] as const)
    groups[name].sort(
      (a, b) =>
        times.get(a.id)! - times.get(b.id)! || a.title.localeCompare(b.title),
    );
  groups.pinned.sort(
    (a, b) => a.pinOrder - b.pinOrder || a.createdAt.localeCompare(b.createdAt),
  );
  return groups;
}

/** Validate the complete portable graph before any persisted replacement. Unknown block types remain opaque. */
export function validateWorkspace(
  input: unknown,
): asserts input is WorkspaceSnapshot {
  const s = input as WorkspaceSnapshot;
  if (!s || s.schemaVersion !== 1)
    throw new Error("Unsupported workspace schema version");
  const fields = [
    "pages",
    "entries",
    "labels",
    "studies",
    "widgets",
    "assets",
    "suggestions",
    "connections",
    "importedEvents",
  ] as const;
  const allIds = new Set<string>();
  for (const field of fields) {
    if (!Array.isArray(s[field])) throw new Error(`Invalid ${field}`);
    for (const item of s[field]) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !item.id ||
        allIds.has(item.id)
      )
        throw new Error("Missing or duplicate ID");
      allIds.add(item.id);
    }
  }
  const time = (v: unknown) => {
    if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
      throw new Error("Invalid time");
  };
  const reminder = (r: any) => {
    if (
      r !== undefined &&
      (!r ||
        typeof r.enabled !== "boolean" ||
        !Number.isFinite(r.beforeMinutes) ||
        r.beforeMinutes < 0 ||
        r.beforeMinutes > 525600)
    )
      throw new Error("Invalid reminder");
    if (r?.time !== undefined) time(r.time);
  };
  const timestamp = (v: unknown) => {
    if (typeof v !== "string" || !Number.isFinite(Date.parse(v)))
      throw new Error("Invalid timestamp");
  };
  const validateBlocks = (blocks: any, depth = 0) => {
    if (!Array.isArray(blocks) || depth > 100)
      throw new Error("Invalid block children");
    for (const b of blocks) {
      if (
        !b ||
        typeof b !== "object" ||
        !b.props ||
        typeof b.props !== "object" ||
        Array.isArray(b.props)
      )
        throw new Error("Invalid block");
      if (b.children !== undefined) validateBlocks(b.children, depth + 1);
    }
  };
  const pages = new Map(s.pages.map((p) => [p.id, p])),
    labels = new Set(s.labels.map((l) => l.id)),
    connections = new Set(s.connections.map((c) => c.id));
  const requirePage = (id: string) => {
    if (!pages.has(id)) throw new Error(`Missing referenced page: ${id}`);
  };
  const revision = (r: number) => {
    if (!Number.isSafeInteger(r) || r < 1) throw new Error("Invalid revision");
  };
  const resources = new Map(
    [...s.studies, ...s.widgets, ...s.assets].map((x) => [x.id, x]),
  );
  for (const p of s.pages) {
    if (
      typeof p.title !== "string" ||
      !Array.isArray(p.blocks) ||
      !Array.isArray(p.labels) ||
      !["active", "completed", "archived", "trashed"].includes(p.status) ||
      typeof p.isTemplate !== "boolean" ||
      typeof p.pinned !== "boolean" ||
      !Number.isFinite(p.pinOrder)
    )
      throw new Error("Invalid page");
    revision(p.revision);
    timestamp(p.createdAt);
    timestamp(p.updatedAt);
    if (p.trashedAt !== null) timestamp(p.trashedAt);
    if (
      p.deadline === undefined ||
      !(p.parentId === null || typeof p.parentId === "string")
    )
      throw new Error("Invalid page metadata");
    reminder(p.reminder);
    if (p.remindersResumedAt !== undefined) timestamp(p.remindersResumedAt);
    const completion = p.completionState;
    if (completion !== undefined) {
      if (!completion || p.status === 'active' || !Array.isArray(completion.entries))
        throw new Error('Invalid portable completion state');
      if (completion.reminder !== undefined) {
        const saved = completion.reminder;
        if (!saved || saved.before?.enabled !== true || saved.after?.enabled !== false || !('deadline' in saved))
          throw new Error('Invalid completion reminder');
        reminder(saved.before); reminder(saved.after);
        if (saved.deadline !== null) validateDate(saved.deadline);
      }
      const ids = new Set<string>();
      for (const saved of completion.entries) {
        if (!saved || typeof saved.id !== 'string' || !saved.id || ids.has(saved.id) ||
            typeof saved.active !== 'boolean' ||
            !Number.isSafeInteger(saved.revisionAfterCompletion) || saved.revisionAfterCompletion < 1 ||
            s.entries.some(e => e.id === saved.id && e.pageId !== p.id))
          throw new Error('Invalid portable completion entry');
        ids.add(saved.id);
        reminder(saved.reminder);
      }
    }
    const trash = (
      p as Page & {
        trashState?: {
          status: string;
          reminder?: unknown;
          entries: {
            id: string;
            active: boolean;
            reminder?: unknown;
            revisionAfterTrash: number;
          }[];
        };
      }
    ).trashState;
    if (trash !== undefined) {
      if (
        !trash ||
        p.status !== "trashed" ||
        !["active", "completed", "archived"].includes(trash.status) ||
        !Array.isArray(trash.entries)
      )
        throw new Error("Invalid portable trash state");
      reminder(trash.reminder);
      const entryIds = new Set<string>();
      for (const saved of trash.entries) {
        if (
          !saved ||
          typeof saved.active !== "boolean" ||
          entryIds.has(saved.id) ||
          !s.entries.some((e) => e.id === saved.id && e.pageId === p.id)
        )
          throw new Error("Invalid portable trash entry reference");
        entryIds.add(saved.id);
        revision(saved.revisionAfterTrash);
        reminder(saved.reminder);
      }
    }
    validateBlocks(p.blocks);
    if (p.deadline) validateDate(p.deadline);
    if (p.parentId) requirePage(p.parentId);
    for (const label of p.labels)
      if (!labels.has(label)) throw new Error("Missing label");
    const ancestors = new Set([p.id]);
    let parent = p.parentId;
    while (parent) {
      if (ancestors.has(parent)) throw new Error("Page parent cycle");
      ancestors.add(parent);
      parent = pages.get(parent)!.parentId;
    }
    for (const b of flattenBlocks(p.blocks)) {
      if (
        !b ||
        typeof b.id !== "string" ||
        !b.id ||
        allIds.has(b.id) ||
        typeof b.type !== "string" ||
        !b.props ||
        typeof b.props !== "object"
      )
        throw new Error("Invalid or duplicate block ID");
      allIds.add(b.id);
      for (const [name, value] of Object.entries(b.props)) {
        if (
          ["studyId", "widgetId", "assetId", "resourceId"].includes(name) &&
          typeof value === "string"
        ) {
          const record = resources.get(value);
          if (!record || record.pageId !== p.id)
            throw new Error(`Missing referenced resource: ${value}`);
        }
        if (["pageId", "subpageId"].includes(name) && typeof value === "string")
          requirePage(value);
      }
    }
  }
  for (const e of s.entries) {
    requirePage(e.pageId);
    revision(e.revision);
    validateDate(e.when);
    if (e.endTime !== undefined) time(e.endTime);
    reminder(e.reminder);
    if (
      !["work", "event"].includes(e.kind) ||
      !["planned", "done", "cancelled"].includes(e.status) ||
      typeof e.active !== "boolean" ||
      !e.exceptions ||
      typeof e.exceptions !== "object"
    )
      throw new Error("Invalid calendar entry");
    if (
      e.blockId &&
      !flattenBlocks(pages.get(e.pageId)!.blocks).some(
        (b) => b.id === e.blockId,
      ) &&
      e.active
    )
      throw new Error("Missing linked block");
    if (e.repeat) {
      if (e.repeat.frequency !== "weekly") throw new Error("Invalid repeat");
      if (e.repeat.until) {
        assertDateString(e.repeat.until);
        if (e.repeat.until < e.when.date) throw new Error("Invalid repeat end");
      }
    }
    for (const [day, exception] of Object.entries(e.exceptions)) {
      if (!isSeriesDate(e, day)) throw new Error("Invalid occurrence date");
      if (exception.when) validateDate(exception.when);
      if (exception.endTime !== undefined) time(exception.endTime);
      if (
        exception.status &&
        !["planned", "done", "cancelled"].includes(exception.status)
      )
        throw new Error("Invalid occurrence status");
    }
  }
  for (const r of [...s.studies, ...s.widgets, ...s.assets])
    requirePage(r.pageId);
  for (const label of s.labels)
    if (
      typeof label.name !== "string" ||
      !label.name.trim() ||
      (label.color !== undefined && typeof label.color !== "string")
    )
      throw new Error("Invalid label");
  for (const r of s.studies) {
    revision(r.revision);
    if (
      typeof r.title !== "string" ||
      !["quiz", "flashcards"].includes(r.kind) ||
      !Array.isArray(r.cards) ||
      !Array.isArray(r.questions) ||
      !Array.isArray(r.attempts)
    )
      throw new Error("Invalid study");
    for (const card of r.cards) {
      if (
        !card ||
        typeof card.front !== "string" ||
        typeof card.back !== "string" ||
        (card.review !== undefined &&
          !["again", "got-it"].includes(card.review))
      )
        throw new Error("Invalid flashcard");
      if (card.reviewedAt !== undefined) timestamp(card.reviewedAt);
    }
    for (const question of r.questions) {
      if (
        !question ||
        !["multiple-choice", "short-answer"].includes(question.type) ||
        typeof question.prompt !== "string" ||
        typeof question.answer !== "string" ||
        (question.explanation !== undefined &&
          typeof question.explanation !== "string") ||
        (question.choices !== undefined &&
          (!Array.isArray(question.choices) ||
            question.choices.some((choice) => typeof choice !== "string")))
      )
        throw new Error("Invalid quiz question");
    }
    const questionIds = new Set(r.questions.map((q) => q.id));
    for (const attempt of r.attempts) {
      if (!attempt) throw new Error("Invalid study attempt");
      timestamp(attempt.at);
      if (
        attempt.score !== undefined &&
        (typeof attempt.score !== "number" || !Number.isFinite(attempt.score))
      )
        throw new Error("Invalid attempt score");
      if (
        !attempt.answers ||
        typeof attempt.answers !== "object" ||
        Array.isArray(attempt.answers) ||
        Object.entries(attempt.answers).some(
          ([id, answer]) => !questionIds.has(id) || typeof answer !== "string",
        )
      )
        throw new Error("Missing referenced study question");
      if (
        attempt.selfAssessment !== undefined &&
        (typeof attempt.selfAssessment !== "object" ||
          !attempt.selfAssessment ||
          Array.isArray(attempt.selfAssessment) ||
          Object.entries(attempt.selfAssessment).some(
            ([id, value]) =>
              !questionIds.has(id) || !["again", "got-it"].includes(value),
          ))
      )
        throw new Error("Invalid study self-assessment");
    }
    for (const child of [...r.cards, ...r.questions, ...r.attempts]) {
      if (typeof child.id !== "string" || !child.id || allIds.has(child.id))
        throw new Error("Duplicate study child ID");
      allIds.add(child.id);
    }
  }
  for (const r of s.widgets) {
    revision(r.revision);
    if (
      typeof r.title !== "string" ||
      typeof r.source !== "string" ||
      !Number.isSafeInteger(r.version) ||
      r.version < 1 ||
      !Array.isArray(r.versions) ||
      !r.state ||
      typeof r.state !== "object" ||
      Array.isArray(r.state)
    )
      throw new Error("Invalid widget");
    for (const previous of r.versions) {
      if (
        !previous ||
        !Number.isSafeInteger(previous.version) ||
        previous.version < 1 ||
        typeof previous.source !== "string"
      )
        throw new Error("Invalid widget version");
    }
  }
  for (const a of s.assets) {
    if (
      !["copy", "file-link", "folder-link"].includes(a.kind) ||
      typeof a.name !== "string" ||
      !Number.isFinite(a.size) ||
      a.size < 0
    )
      throw new Error("Invalid asset");
    if (
      a.storageName &&
      (/[\\/]/.test(a.storageName) || a.storageName === "..")
    )
      throw new Error("Invalid asset storage name");
  }
  for (const c of s.connections)
    if (
      !["google", "microsoft", "openai"].includes(c.provider) ||
      !["connected", "expired", "error"].includes(c.status) ||
      !c.settings ||
      typeof c.settings !== "object"
    )
      throw new Error("Invalid connection");
  for (const suggestion of s.suggestions) {
    if (!connections.has(suggestion.connectionId))
      throw new Error("Missing suggestion connection");
    if (
      !["pending", "accepted", "dismissed"].includes(suggestion.status) ||
      !suggestion.candidateKey
    )
      throw new Error("Invalid suggestion");
    if (suggestion.date) validateDate(suggestion.date);
    if (suggestion.pageId) requirePage(suggestion.pageId);
    if (suggestion.possibleUpdatePageId)
      requirePage(suggestion.possibleUpdatePageId);
  }
  for (const e of s.importedEvents) {
    if (!connections.has(e.connectionId))
      throw new Error("Missing event connection");
    validateDate(e.when);
  }
  if (
    !s.settings ||
    s.settings.weekStartsOn !== 1 ||
    !["calendar", "space", "suggestions", "connections", "settings"].includes(
      s.settings.view,
    ) ||
    !["month", "week"].includes(s.settings.calendarView) ||
    !Number.isFinite(s.settings.textScale) ||
    s.settings.textScale < 0.5 ||
    s.settings.textScale > 3
  )
    throw new Error("Invalid settings");
  for (const name of [
    "sidebarExpanded",
    "backupEnabled",
    "reducedMotion",
    "onboardingDismissed",
  ] as const)
    if (typeof s.settings[name] !== "boolean")
      throw new Error("Invalid setting type");
  for (const name of ["backupPath", "backupLastAt"] as const)
    if (s.settings[name] !== undefined && typeof s.settings[name] !== "string")
      throw new Error("Invalid setting type");
}
