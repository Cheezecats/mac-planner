import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { EncryptedRepository } from '../../src/core/repository';
import { PlannerService } from '../../src/core/service';
import { validateWorkspace } from '../../src/core/domain';
import type { Page, CalendarEntry, PageReopenResult, WorkspaceSnapshot } from '../../src/shared/types';

let dir: string, db: EncryptedRepository, service: PlannerService;
const key = Buffer.alloc(32, 8);
const when = { date: '2026-10-15', time: '09:00', timeZone: 'UTC' };
const reminder = { enabled: true, beforeMinutes: 15 };
const run = <T = any>(method: string, params: Record<string, unknown> = {}): T => service.execute(method, params) as T;
const snapshot = () => run<WorkspaceSnapshot>('workspace.get');
const create = () => run<Page>('page.create', { title: 'Essay', deadline: when });
const schedule = (page: Page, extra = {}) => run<CalendarEntry>('schedule.create', { pageId: page.id, kind: 'work', when, reminder, ...extra });
const complete = (page: Page) => run<Page>('page.complete', { id: page.id, expectedRevision: page.revision });
const reopen = (page: Page) => run<PageReopenResult>('page.reopen', { id: page.id, expectedRevision: page.revision });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'planner-reopen-')); db = new EncryptedRepository(join(dir, 'workspace.db'), key); service = new PlannerService(db); });
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('page reopen', () => {
  it('retains chosen reminders when completed-page autosave sends an unchanged full Draft', () => {
    let p = create(); p = run('page.update', { id: p.id, expectedRevision: p.revision, changes: { reminder } });
    schedule(p); p = complete(p);
    p = run('page.update', { id: p.id, expectedRevision: p.revision, changes: {
      title: 'Writing revised after completion',
      blocks: [{ id: 'autosaved-body', type: 'paragraph', props: {}, content: 'New paragraph' }],
      deadline: structuredClone(p.deadline),
      labels: [...p.labels],
      pinned: p.pinned,
      pinOrder: p.pinOrder,
      reminder: structuredClone(p.reminder),
    } });
    expect(reopen(p)).toMatchObject({
      page: { status: 'active', title: 'Writing revised after completion', reminder, blocks: [{ content: 'New paragraph' }] },
      restoredEntryCount: 1, skippedEntryCount: 0,
    });
  });
  it('restores unchanged completion-disabled work and reminders while retaining later writing', () => {
    let p = create(); p = run('page.update', { id: p.id, expectedRevision: p.revision, changes: { reminder } });
    const work = schedule(p); const event = schedule(p, { kind: 'event' });
    const done = schedule(p, { reminder: undefined }); run('schedule.status', { id: done.id, expectedRevision: done.revision, status: 'done' });
    p = complete(p); p = run('page.update', { id: p.id, expectedRevision: p.revision, changes: { title: 'Revised essay', blocks: [{ id: 'writing', type: 'paragraph', props: {}, content: 'New writing' }] } });
    const result = reopen(p);
    expect(result).toMatchObject({ page: { status: 'active', title: 'Revised essay', reminder }, restoredEntryCount: 2, skippedEntryCount: 0 });
    expect(result.page.blocks[0].content).toBe('New writing');
    expect(result.message).toMatch(/reopened|restored/i);
    expect(snapshot().entries.find(e => e.id === work.id)).toMatchObject({ active: true, reminder });
    expect(snapshot().entries.find(e => e.id === event.id)).toMatchObject({ active: true, reminder });
    expect(snapshot().entries.find(e => e.id === done.id)).toMatchObject({ active: true, status: 'done' });
    expect(result.page.completionState).toBeUndefined();
  });
  it('skips changed and deleted entries, preserving subsequent scheduling and reminder choices', () => {
    let p = create(); p = run('page.update', { id: p.id, expectedRevision: p.revision, changes: { reminder } });
    const changed = schedule(p), deleted = schedule(p), stable = schedule(p);
    p = complete(p);
    run('schedule.update', { id: changed.id, expectedRevision: changed.revision + 1, changes: { when: { ...when, date: '2026-10-16' }, reminder: { enabled: true, beforeMinutes: 45 } } });
    run('schedule.remove', { id: deleted.id, expectedRevision: deleted.revision + 1 });
    p = run('page.update', { id: p.id, expectedRevision: p.revision, changes: { reminder: { enabled: false, beforeMinutes: 60 }, deadline: { ...when, date: '2026-10-20' } } });
    const result = reopen(p);
    expect(result).toMatchObject({ restoredEntryCount: 1, skippedEntryCount: 2, page: { reminder: { enabled: false, beforeMinutes: 60 }, deadline: { ...when, date: '2026-10-20' } } });
    expect(snapshot().entries.find(e => e.id === changed.id)).toMatchObject({ active: false, when: { ...when, date: '2026-10-16' }, reminder: { enabled: true, beforeMinutes: 45 } });
    expect(snapshot().entries.some(e => e.id === deleted.id)).toBe(false);
    expect(snapshot().entries.find(e => e.id === stable.id)?.active).toBe(true);
  });
  it('does not revive work whose linked block was removed after completion', () => {
    let p = run<Page>('page.create', { blocks: [{ id: 'block', type: 'paragraph', props: {} }] });
    const entry = schedule(p, { blockId: 'block' }); p = complete(p);
    p = run('page.patch', { id: p.id, expectedRevision: p.revision, operations: [{ type: 'delete', id: 'block' }] });
    expect(reopen(p)).toMatchObject({ restoredEntryCount: 0, skippedEntryCount: 1 });
    expect(snapshot().entries.find(e => e.id === entry.id)?.active).toBe(false);
  });
  it('requires the latest revision and a completed page without mutating rejected requests', () => {
    const original = create(); expect(() => reopen(original)).toThrow(/completed/i);
    const p = complete(original), before = snapshot();
    expect(() => reopen(original)).toThrow(/Revision conflict/); expect(snapshot()).toEqual(before);
    const result = reopen(p); expect(() => reopen(result.page)).toThrow(/completed/i);
  });
  it('repeated completion retains the first restoration state, then supports another complete/reopen cycle', () => {
    let p = create(); const entry = schedule(p); p = complete(p); p = complete(p);
    expect(reopen(p).restoredEntryCount).toBe(1);
    p = snapshot().pages[0]; p = complete(p); expect(reopen(p).restoredEntryCount).toBe(1);
    expect(snapshot().entries.find(e => e.id === entry.id)?.active).toBe(true);
  });
  it('retains restoration metadata across encrypted restart, portable import and a schema upgrade', () => {
    let p = create(); schedule(p); p = complete(p); db.close();
    const raw = new Database(join(dir, 'workspace.db')); raw.pragma('user_version = 0'); raw.close();
    db = new EncryptedRepository(join(dir, 'workspace.db'), key); service = new PlannerService(db);
    expect(snapshot().pages[0].completionState).toEqual(p.completionState);
    const portable = run('workspace.export'); run('workspace.import', { snapshot: portable });
    expect(db.getHistory()).toEqual([]); expect(reopen(snapshot().pages[0]).restoredEntryCount).toBe(1);
  });
  it('retains restoration data in encrypted SQLite backups', async () => {
    let p = create(); schedule(p); p = complete(p);
    const backupPath = join(dir, 'backup.db'); await db.backupTo(backupPath);
    const backup = new EncryptedRepository(backupPath, key);
    try {
      const backedUp = new PlannerService(backup);
      const result = backedUp.execute('page.reopen', { id: p.id, expectedRevision: p.revision }) as PageReopenResult;
      expect(result.restoredEntryCount).toBe(1);
      expect((backedUp.execute('workspace.get') as WorkspaceSnapshot).entries[0].active).toBe(true);
    } finally { backup.close(); }
    expect(snapshot().pages[0].status).toBe('completed');
  });
  it('portable restoration retains references to deleted entries so reopen reports them without recreating them', () => {
    let p = create(); const deleted = schedule(p), retained = schedule(p); p = complete(p);
    run('schedule.remove', { id: deleted.id, expectedRevision: deleted.revision + 1 });
    run('workspace.import', { snapshot: run('workspace.export') });
    expect(reopen(snapshot().pages[0])).toMatchObject({ restoredEntryCount: 1, skippedEntryCount: 1 });
    expect(snapshot().entries.map(e => e.id)).toEqual([retained.id]);
  });
  it('restores a weekly planned exception without changing the completed base status', () => {
    let p = create(); const entry = schedule(p, { repeat: { frequency: 'weekly' } });
    let e = run<CalendarEntry>('schedule.status', { id: entry.id, expectedRevision: entry.revision, status: 'done' });
    e = run('schedule.status', { id: e.id, expectedRevision: e.revision, occurrenceDate: '2026-10-22', scope: 'one', status: 'planned' });
    p = complete(p); expect(snapshot().entries[0].active).toBe(false);
    expect(reopen(p).restoredEntryCount).toBe(1);
    expect(snapshot().entries[0]).toMatchObject({ active: true, status: 'done', exceptions: { '2026-10-22': { status: 'planned' } } });
  });
  it('keeps generic Undo separate from reopening after later writing', () => {
    let p = create(); schedule(p); p = complete(p);
    p = run('page.update', { id: p.id, expectedRevision: p.revision, changes: { title: 'Later writing' } });
    p = run('page.undo', { id: p.id });
    expect(p).toMatchObject({ title: 'Essay', status: 'completed' }); expect(snapshot().entries[0].active).toBe(false);
    expect(reopen(p).restoredEntryCount).toBe(1);
  });
  it('legacy completion fallback preserves changed reminders and skips changed/deleted entries', () => {
    let p = create(); p = run('page.update', { id: p.id, expectedRevision: p.revision, changes: { reminder } });
    const moved = schedule(p), deleted = schedule(p), stable = schedule(p); p = complete(p);
    const legacy = snapshot(); delete legacy.pages[0].completionState; db.commitSnapshot(legacy, db.getHistory());
    run('schedule.move', { id: moved.id, expectedRevision: moved.revision + 1, when: { ...when, date: '2026-10-30' } });
    run('schedule.remove', { id: deleted.id, expectedRevision: deleted.revision + 1 });
    p = run('page.update', { id: p.id, expectedRevision: p.revision, changes: { reminder: { enabled: false, beforeMinutes: 60 } } });
    expect(reopen(p)).toMatchObject({ restoredEntryCount: 1, skippedEntryCount: 2, page: { reminder: { enabled: false, beforeMinutes: 60 } } });
    expect(snapshot().entries.find(e => e.id === stable.id)?.active).toBe(true);
  });
  it('keeps reminder resumption portable and clears it on duplicate/template creation', () => {
    let p = create(); p = complete(p); p = reopen(p).page;
    expect(Number.isFinite(Date.parse(p.remindersResumedAt!))).toBe(true);
    run('workspace.import', { snapshot: run('workspace.export') }); expect(snapshot().pages[0].remindersResumedAt).toBe(p.remindersResumedAt);
    expect(run<Page>('page.duplicate', { id: p.id }).remindersResumedAt).toBeUndefined();
    const template = run<Page>('page.duplicate', { id: p.id, asTemplate: true }); expect(template.remindersResumedAt).toBeUndefined();
    expect(run<Page>('page.instantiate', { id: template.id }).remindersResumedAt).toBeUndefined();
    const bad = snapshot(); bad.pages[0].remindersResumedAt = 'not a timestamp'; expect(() => run('workspace.import', { snapshot: bad })).toThrow(/timestamp/i);
  });
  it('clears completion metadata on duplicates and template instances', () => {
    let p = create(); schedule(p); p = complete(p);
    expect(p.completionState?.entries).toHaveLength(1);
    const duplicate = run<Page>('page.duplicate', { id: p.id }); expect(duplicate.completionState).toBeUndefined();
    const template = run<Page>('page.duplicate', { id: p.id, asTemplate: true });
    expect(template.completionState).toBeUndefined();
    const instance = run<Page>('page.instantiate', { id: template.id }); expect(instance.completionState).toBeUndefined();
  });
  it('uses legacy completion history and refuses to guess when both sources are missing', () => {
    let p = create(); const entry = schedule(p); p = complete(p);
    const legacy = snapshot(); delete legacy.pages[0].completionState; db.commitSnapshot(legacy, db.getHistory());
    expect(reopen(legacy.pages[0]).restoredEntryCount).toBe(1);
    p = complete(snapshot().pages[0]); const missing = snapshot(); delete missing.pages[0].completionState; run('workspace.import', { snapshot: missing });
    const result = reopen(missing.pages[0]); expect(result).toMatchObject({ page: { status: 'active' }, restoredEntryCount: 0, skippedEntryCount: 0 }); expect(result.message).toMatch(/unavailable|no.*restored/i);
    expect(snapshot().entries.find(e => e.id === entry.id)?.active).toBe(false);
  });
  it('rejects malformed portable completion metadata without replacing the current workspace', () => {
    let p = create(); schedule(p); p = complete(p); const valid = snapshot();
    for (const bad of [{ entries: [{ id: '', active: true, revisionAfterCompletion: 2 }] }, { entries: [{ id: 'missing', active: 'yes', revisionAfterCompletion: 2 }] }, { entries: [{ id: 'missing', active: true, revisionAfterCompletion: 0 }] }, { entries: [], reminder: { before: reminder, after: { ...reminder, enabled: true }, deadline: when } }]) {
      const invalid = structuredClone(valid); invalid.pages[0].completionState = bad as any;
      expect(() => run('workspace.import', { snapshot: invalid })).toThrow(/completion/i); expect(snapshot()).toEqual(valid);
    }
    validateWorkspace(valid);
  });
});
