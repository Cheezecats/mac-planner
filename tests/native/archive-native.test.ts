import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { createEmptyWorkspace } from '../../src/core/domain';
import { PlannerService } from '../../src/core/service';
import { decryptPayload } from '../../src/core/repository';
import { sealArchive } from '../../src/electron/archive';
const native = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn(), launch: vi.fn().mockResolvedValue('') }));
vi.mock('electron', () => ({ dialog: { showOpenDialog: native.open, showSaveDialog: native.save }, shell: { openPath: native.launch } }));
import { NativeFiles, validateDocxExpansion, type NativeOptions } from '../../src/electron/files';
import { NativeBackups } from '../../src/electron/backups';
import type { AssetRecord, WorkspaceSnapshot } from '../../src/shared/types';

let directory: string, snapshot: WorkspaceSnapshot, options: NativeOptions;
let backupCalls: string[];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'planner-native-test-'));
  snapshot = createEmptyWorkspace();
  const service = new PlannerService({ getSnapshot: () => structuredClone(snapshot), replaceSnapshot: s => { snapshot = structuredClone(s); } });
  backupCalls = [];
  options = { dataDir: directory, key: randomBytes(32), getWindow: () => null, request: async (method, params) => {
    if (method === 'database.backup') { backupCalls.push(String(params?.path)); await writeFile(String(params?.path), 'encrypted-original'); return; }
    return service.execute(method, params);
  } };
  native.open.mockReset(); native.save.mockReset(); native.launch.mockClear();
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
function choose(path: string) { native.open.mockResolvedValueOnce({ canceled: false, filePaths: [path] }); }
async function page() { return await options.request('page.create', { title: 'Private page' }) as { id: string }; }
function credentials() {
  const values = new Map<string, unknown>();
  return { get: async (id: string) => values.get(id), set: async (id: string, value: unknown) => { values.set(id, value); } };
}
describe('native chooser permissions and encrypted copies', () => {
  it('scavenges only app-owned plaintext opened copies after a crash', async () => {
    const owner = await page(), original = join(directory, 'original.txt');
    await writeFile(original, 'Private original'); choose(original);
    const files = new NativeFiles(options), asset = await files.handle('file.attach', { pageId: owner.id }) as AssetRecord;
    await files.handle('file.open', { id: asset.id });
    const opened = native.launch.mock.calls.at(-1)![0] as string;
    expect(opened.startsWith(join(directory, 'temporary-open-files') + '/')).toBe(true);
    expect(await readFile(opened, 'utf8')).toBe('Private original');
    expect((await stat(dirname(opened))).mode & 0o777).toBe(0o700);
    const unrelated = join(directory, 'temporary-open-files', 'keep-user-notes');
    await mkdir(unrelated); await writeFile(join(unrelated, 'notes.txt'), 'Unrelated');
    await new NativeFiles(options).initialize();
    await expect(readFile(opened)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(original, 'utf8')).toBe('Private original');
    expect(await readFile(join(unrelated, 'notes.txt'), 'utf8')).toBe('Unrelated');
    expect(await files.handle('file.read', { id: asset.id })).toBe('Private original');
  });
  it('removes opened plaintext during graceful shutdown', async () => {
    const owner = await page(), original = join(directory, 'shutdown.txt');
    await writeFile(original, 'Private original'); choose(original);
    const files = new NativeFiles(options), asset = await files.handle('file.attach', { pageId: owner.id }) as AssetRecord;
    await files.handle('file.open', { id: asset.id });
    const opened = native.launch.mock.calls.at(-1)![0] as string;
    await files.dispose();
    await expect(readFile(opened)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(original, 'utf8')).toBe('Private original');
  });
  it('purges copied bytes and temporary copies only after the final shared asset reference is removed', async () => {
    const first = await page(), second = await page(), original = join(directory, 'shared.txt');
    await writeFile(original, 'Shared private copy'); choose(original);
    const files = new NativeFiles(options), asset = await files.handle('file.attach', { pageId: first.id }) as AssetRecord;
    const shared = { ...asset, id: 'shared-asset', pageId: second.id };
    await options.request('asset.save', { record: shared });
    await files.handle('file.open', { id: asset.id });
    const opened = native.launch.mock.calls.at(-1)![0] as string;
    await files.purgeAssets([asset], [shared]);
    await expect(readFile(opened)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await files.handle('file.read', { id: shared.id })).toBe('Shared private copy');
    await files.purgeAssets([shared], []);
    await expect(readFile(join(directory, 'assets', asset.storageName!))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(original, 'utf8')).toBe('Shared private copy');
    await files.dispose();
  });
  it('revokes a removed linked-file grant without deleting the external original', async () => {
    const owner = await page(), original = join(directory, 'linked-removal.txt');
    await writeFile(original, 'External source'); choose(original);
    const files = new NativeFiles(options), asset = await files.handle('file.link', { pageId: owner.id }) as AssetRecord;
    await files.purgeAssets([asset], []);
    await expect(new NativeFiles(options).handle('file.read', { id: asset.id })).rejects.toThrow(/Locate/);
    expect(await readFile(original, 'utf8')).toBe('External source');
  });
  it('roundtrips a zero-byte attachment', async () => {
    const owner = await page(), path = join(directory, 'empty.txt'); await writeFile(path, ''); choose(path);
    const files = new NativeFiles(options), asset = await files.handle('file.attach', { pageId: owner.id }) as AssetRecord;
    expect(asset.size).toBe(0);
    expect(await files.handle('file.read', { id: asset.id })).toBe('');
  });
  it('stores a selected copy encrypted, reads selected text and refuses forged link paths', async () => {
    const owner = await page(), path = join(directory, 'private.txt');
    await writeFile(path, 'private attachment contents'); choose(path);
    const files = new NativeFiles(options);
    const asset = await files.handle('file.attach', { pageId: owner.id }) as AssetRecord;
    const stored = await readFile(join(directory, 'assets', asset.storageName!));
    expect(stored.includes(Buffer.from('private attachment contents'))).toBe(false);
    expect(decryptPayload(stored, options.key).toString()).toBe('private attachment contents');
    expect(await files.handle('file.read', { id: asset.id })).toBe('private attachment contents');
    const forged = { ...asset, id: 'forged', kind: 'file-link' as const, originalPath: path, storageName: undefined };
    await options.request('asset.save', { record: forged });
    await expect(files.handle('file.read', { id: forged.id })).rejects.toThrow(/Locate/);
    expect(native.launch).not.toHaveBeenCalled();
  });
  it('persists selected link grants encrypted; missing sources require Locate', async () => {
    const owner = await page(), path = join(directory, 'linked.txt');
    await writeFile(path, 'linked contents'); choose(path);
    const files = new NativeFiles(options), asset = await files.handle('file.link', { pageId: owner.id }) as AssetRecord;
    expect((await readFile(join(directory, 'file-grants.enc'))).includes(Buffer.from(path))).toBe(false);
    expect(await new NativeFiles(options).handle('file.read', { id: asset.id })).toBe('linked contents');
    await rm(path);
    await expect(files.handle('file.read', { id: asset.id })).rejects.toThrow(/Locate/);
    const replacement = join(directory, 'relocated.txt'); await writeFile(replacement, 'replacement'); choose(replacement);
    await files.handle('file.locate', { id: asset.id });
    expect(await files.handle('file.read', { id: asset.id })).toBe('replacement');
  });
  it('returns only data image previews and rejects text pretending to be an image', async () => {
    const owner = await page(), path = join(directory, 'image.png');
    await writeFile(path, Buffer.from([137,80,78,71,13,10,26,10,0])); choose(path);
    const files = new NativeFiles(options), asset = await files.handle('file.attach', { pageId: owner.id }) as AssetRecord;
    expect(await files.handle('file.preview', { id: asset.id })).toEqual({ url: 'data:image/png;base64,iVBORw0KGgoA' });
    const text = join(directory, 'fake.png'); await writeFile(text, '<svg>unsafe</svg>'); choose(text);
    const fake = await files.handle('file.attach', { pageId: owner.id }) as AssetRecord;
    await expect(files.handle('file.preview', { id: fake.id })).rejects.toThrow(/Preview supports/);
  });
});
describe('portable backups and restore preservation', () => {
  it('retains seven encrypted versions, omits credentials, and uses a chosen folder', async () => {
    await page();
    const destination = join(directory, 'backups'); await mkdir(destination); choose(destination);
    const backups = new NativeBackups({ ...options, credentials: credentials() });
    await backups.handle('backup.configure', { password: 'secret passphrase' });
    for (let i = 0; i < 8; i++) await backups.handle('backup.create');
    const archives = await readdir(destination);
    expect(archives).toHaveLength(7);
    expect((await readFile(join(destination, archives[0]))).includes(Buffer.from('Private page'))).toBe(false);
    const before = await readdir(destination); await backups.daily(); expect(await readdir(destination)).toEqual(before);
    await options.request('settings.update', { changes: { backupPath: '/unselected/path' } });
    await backups.handle('backup.create'); expect(await readdir(destination)).toHaveLength(7);
  });
  it('fully validates wrong-password archives before making any database backup or mutation', async () => {
    await page(); const original = structuredClone(snapshot);
    const path = join(directory, 'wrong.plannerbackup'); await writeFile(path, sealArchive({ snapshot: createEmptyWorkspace(), assets: {} }, 'different password')); choose(path);
    const backups = new NativeBackups({ ...options, credentials: credentials() });
    await expect(backups.handle('backup.restore', { password: 'secret passphrase' })).rejects.toThrow(/passphrase/);
    expect(snapshot).toEqual(original); expect(backupCalls).toHaveLength(0);
  });
  it('preserves the old database and copied assets; re-encrypts staged assets with the current key', async () => {
    const owner = await page(), path = join(directory, 'source.txt'); await writeFile(path, 'copied source'); choose(path);
    const files = new NativeFiles(options), asset = await files.handle('file.attach', { pageId: owner.id }) as AssetRecord;
    const priorStorage = asset.storageName!;
    const archive = join(directory, 'restore.plannerbackup');
    await writeFile(archive, sealArchive({ snapshot, assets: { [asset.id]: Buffer.from('copied source').toString('base64') } }, 'secret passphrase'));
    await options.request('page.create', { title: 'Only in original' }); choose(archive);
    const restored = await new NativeBackups({ ...options, credentials: credentials() }).handle('backup.restore', { password: 'secret passphrase' }) as WorkspaceSnapshot;
    expect(restored.pages).toHaveLength(1);
    expect(backupCalls).toHaveLength(1); expect(await readFile(backupCalls[0], 'utf8')).toBe('encrypted-original');
    expect(restored.assets[0].storageName).not.toBe(priorStorage);
    expect(await readFile(join(directory, 'assets', priorStorage))).toBeTruthy();
    expect(await files.handle('file.read', { id: asset.id })).toBe('copied source');
  });
  it('leaves original workspace recoverable if the atomic import fails', async () => {
    await page(); const original = structuredClone(snapshot);
    const archive = join(directory, 'restore-failure.plannerbackup');
    await writeFile(archive, sealArchive({ snapshot: createEmptyWorkspace(), assets: {} }, 'secret passphrase')); choose(archive);
    const request = options.request;
    const backups = new NativeBackups({ ...options, credentials: credentials(), request: async (method, params) => {
      if (method === 'workspace.import') throw new Error('Disk write failed');
      return request(method, params);
    } });
    await expect(backups.handle('backup.restore', { password: 'secret passphrase' })).rejects.toThrow('Disk write failed');
    expect(snapshot).toEqual(original);
    expect(backupCalls).toHaveLength(1);
    expect(await readFile(backupCalls[0], 'utf8')).toBe('encrypted-original');
  });
});

function zip(content: Buffer, claimedSize = content.length): Buffer {
  const name = Buffer.from('word/document.xml'), compressed = deflateRawSync(content);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(claimedSize, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(claimedSize, 24); central.writeUInt16LE(name.length, 28);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, central, name, eocd]);
}
describe('bounded DOCX extraction', () => {
  it('checks actual expansion and rejects underreported zip bombs before reading', () => {
    expect(() => validateDocxExpansion(zip(Buffer.from('<xml>test</xml>')))).not.toThrow();
    expect(() => validateDocxExpansion(zip(Buffer.alloc(1024 * 1024, 65), 1))).toThrow();
    expect(() => validateDocxExpansion(Buffer.from('not a zip'))).toThrow();
  });
  it('extracts text from an actual selected DOCX archive', async () => {
    const owner = await page(), path = join(directory, 'selected.docx');
    const document = Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Selected DOCX</w:t></w:r></w:p></w:body></w:document>');
    await writeFile(path, zip(document)); choose(path);
    const files = new NativeFiles(options), asset = await files.handle('file.attach', { pageId: owner.id }) as AssetRecord;
    expect(await files.handle('file.read', { id: asset.id })).toContain('Selected DOCX');
  });
});
describe('bounded PDF extraction', () => {
  it('extracts text from an actual selected PDF', async () => {
    const content = 'BT /F1 12 Tf 10 100 Td (Selected PDF) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const owner = await page(), path = join(directory, 'selected.pdf'); await writeFile(path, pdf); choose(path);
    const files = new NativeFiles(options), asset = await files.handle('file.attach', { pageId: owner.id }) as AssetRecord;
    expect(await files.handle('file.read', { id: asset.id })).toContain('Selected PDF');
  });
});
