import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createEmptyWorkspace } from '../../src/core/domain';
import { PlannerService } from '../../src/core/service';
import type { AppEvent, WorkspaceSnapshot } from '../../src/shared/types';
vi.mock('electron', () => ({ shell: { openExternal: async () => {} }, safeStorage: {} }));
import { EncryptedVault } from '../../src/electron/vault';
import { IntegrationHost } from '../../src/electron/integration-host';

let directory: string, snapshot: WorkspaceSnapshot, vault: EncryptedVault, host: IntegrationHost;
let events: AppEvent[];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'planner-purge-history-'));
  snapshot = createEmptyWorkspace();
  const service = new PlannerService({ getSnapshot: () => structuredClone(snapshot), replaceSnapshot: s => { snapshot = structuredClone(s); } });
  const request = async <T>(method: string, params?: Record<string, unknown>) => service.execute(method, params) as T;
  await request('page.create', { title: 'Private study' });
  snapshot.pages[0].id = 'private-page';
  snapshot.connections.push({ id: 'openai-one', provider: 'openai', accountName: 'Test account', status: 'connected', scopes: [] } as any);
  vault = await EncryptedVault.open(directory, randomBytes(32));
  await vault.set('oauth:session:openai-one', { connectionId: 'openai-one', provider: 'openai', accountId: 'account-one', accountName: 'Test account', clientId: 'test-client', accessToken: 'test-token', idToken: '', scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600000 });
  events = [];
  host = new IntegrationHost(request, vault, async () => '', event => events.push(event));
});
afterEach(async () => { vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });

describe('permanent page purge and assistant privacy', () => {
  it('cleans orphan histories at startup while retaining restorable trashed-page history', async () => {
    snapshot.pages[0].status = 'trashed';
    await vault.set('account:old-account:assistant:history:private-page', [{role:'user',content:'Restorable study'}]);
    await vault.set('account:old-account:assistant:history:orphan-page', [{role:'user',content:'Purged study'}]);
    await host.initialize();
    expect(await vault.get('account:old-account:assistant:history:orphan-page')).toBeNull();
    expect(await vault.get('account:old-account:assistant:history:private-page')).toEqual([{role:'user',content:'Restorable study'}]);
  });
  it('erases histories for the purged page across connected and disconnected accounts only', async () => {
    await vault.set('account:account-one:assistant:history:private-page', [{role:'user',content:'Private study'}]);
    await vault.set('account:disconnected:assistant:history:private-page', [{role:'user',content:'Old account study'}]);
    await vault.set('account:account-one:assistant:history:other-page', [{role:'user',content:'Keep other study'}]);
    await host.purgePage('private-page');
    expect(await vault.get('account:account-one:assistant:history:private-page')).toBeNull();
    expect(await vault.get('account:disconnected:assistant:history:private-page')).toBeNull();
    expect(await vault.get('account:account-one:assistant:history:other-page')).toEqual([{role:'user',content:'Keep other study'}]);
    expect(await vault.get('oauth:session:openai-one')).toBeTruthy();
  });
  it('refuses stored history reads when the page no longer exists', async () => {
    await vault.set('account:account-one:assistant:history:missing-page', [{role:'user',content:'Deleted data'}]);
    await expect(host.handle('assistant.history', { pageId: 'missing-page' })).rejects.toThrow(/unavailable|not found/i);
  });
  it('cancels in-flight inference and cannot recreate purged history after a late response', async () => {
    let deliver!: (response:Response)=>void;
    let started!: ()=>void;
    const fetching = new Promise<void>(resolve => { started = resolve; });
    vi.stubGlobal('fetch', async () => { started(); return new Promise<Response>(resolve => { deliver = resolve; }); });
    await host.handle('assistant.send', { pageId: 'private-page', text: 'Explain my notes', model: 'test-model' });
    await fetching;
    await host.purgePage('private-page');
    deliver(new Response('data: {"type":"response.completed","response":{"output":[]}}\n\n'));
    await vi.waitFor(() => expect(events.some(e => e.type === 'assistant-error')).toBe(true));
    expect(await vault.get('account:account-one:assistant:history:private-page')).toBeNull();
    expect(events.some(e => e.type === 'assistant-done')).toBe(false);
  });
});
