import { mkdir, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { encryptPayload, decryptPayload } from '../core/repository';
import { sealArchive, openArchive, safeAssetName, MAX_ARCHIVE_BYTES } from './archive';
import { atomicPrivateWrite, boundedRead, chooseOpen, chooseSave, type NativeOptions } from './files';
import type { WorkspaceSnapshot } from '../shared/types';

interface BackupCredentials { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; delete?(key: string): Promise<void>; remove?(key: string): Promise<void> }
export interface BackupOptions extends NativeOptions { credentials: BackupCredentials }
interface Configuration { directory: string }
const PASSWORD_ID = 'native:backup-passphrase';
const filenamePattern = /^planner-\d{4}-\d{2}-\d{2}-\d{6}-[a-f0-9-]+\.plannerbackup$/;
function localDay(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export class NativeBackups {
  private operations: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: BackupOptions) {}
  private async configuration(): Promise<Configuration | null> {
    try {
      const config = JSON.parse(decryptPayload(await readFile(join(this.options.dataDir, 'backup-config.enc')), this.options.key).toString()) as Configuration;
      if (typeof config.directory !== 'string' || await realpath(config.directory) !== config.directory || !(await stat(config.directory)).isDirectory()) throw new Error('Backup folder is missing or changed. Choose it again in Settings.');
      return config;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  private async password(provided?: unknown): Promise<string> {
    const value = provided ?? await this.options.credentials.get(PASSWORD_ID);
    if (typeof value !== 'string' || value.length < 8 || value.length > 4096) throw new Error('Use a backup passphrase of at least eight characters');
    return value;
  }
  private async archive(password: string): Promise<Buffer> {
    const snapshot = await this.options.request('workspace.export') as WorkspaceSnapshot;
    const assets: Record<string, string> = {};
    let total = 0;
    for (const asset of snapshot.assets.filter(a => a.kind === 'copy')) {
      const path = join(this.options.dataDir, 'assets', safeAssetName(asset.storageName ?? ''));
      const info = await stat(path);
      total += info.size;
      if (total > MAX_ARCHIVE_BYTES || info.size > 128 * 1024 * 1024 + 29) throw new Error('Copied assets exceed backup size limit');
      const bytes = decryptPayload(await boundedRead(path, 128 * 1024 * 1024 + 29), this.options.key);
      assets[safeAssetName(asset.id)] = bytes.toString('base64');
    }
    return sealArchive({ snapshot, assets }, password);
  }
  private async create(provided?: unknown): Promise<unknown> {
    const config = await this.configuration();
    if (!config) throw new Error('Choose a backup folder in Settings first');
    const password = await this.password(provided), bytes = await this.archive(password);
    const stamp = new Date().toISOString(), name = `planner-${stamp.slice(0, 10)}-${stamp.slice(11, 19).replace(/:/g, '')}-${randomUUID()}.plannerbackup`;
    const path = join(config.directory, name);
    // A new unique name plus atomic rename prevents retaining an interrupted archive.
    await atomicPrivateWrite(path, bytes);
    const names = (await readdir(config.directory)).filter(n => filenamePattern.test(n)).sort().reverse();
    for (const old of names.slice(7)) await rm(join(config.directory, old));
    await this.options.request('settings.update', { changes: { backupLastAt: stamp } });
    return { created: true, at: stamp, retained: Math.min(7, names.length) };
  }
  handle(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const operation = this.operations.then(() => this.perform(method, params));
    this.operations = operation.catch(() => {});
    return operation;
  }
  private async perform(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === 'backup.configure') {
      const password = await this.password(params.password);
      const selected = await chooseOpen(this.options, { title: 'Choose daily backup folder', properties: ['openDirectory', 'createDirectory'] });
      if (!selected) return null;
      const directory = await realpath(selected);
      await this.options.credentials.set(PASSWORD_ID, password);
      await atomicPrivateWrite(join(this.options.dataDir, 'backup-config.enc'), encryptPayload(JSON.stringify({ directory }), this.options.key));
      return this.options.request('settings.update', { changes: { backupEnabled: true, backupPath: directory } });
    }
    if (method === 'backup.create') return this.create(params.password);
    if (method === 'export.workspace') {
      const password = await this.password(params.password);
      const path = await chooseSave(this.options, { title: 'Export encrypted workspace', defaultPath: 'Planner.plannerbackup', filters: [{ name: 'Planner encrypted archive', extensions: ['plannerbackup'] }] });
      if (!path) return null;
      await atomicPrivateWrite(path, await this.archive(password));
      return { saved: true };
    }
    if (method === 'backup.restore') {
      const password = await this.password(params.password);
      const path = await chooseOpen(this.options, { title: 'Restore encrypted workspace', properties: ['openFile'], filters: [{ name: 'Planner encrypted archive', extensions: ['plannerbackup'] }] });
      if (!path) return null;
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_ARCHIVE_BYTES + 128) throw new Error('Archive exceeds size limit; original workspace preserved');
      const archive = openArchive(await boundedRead(path, MAX_ARCHIVE_BYTES + 128), password);
      const recovery = join(this.options.dataDir, 'recovery', `restore-${Date.now()}-${randomUUID()}`);
      await mkdir(recovery, { recursive: true, mode: 0o700 });
      // Keep the original encrypted database, including Undo, before any replacement.
      await this.options.request('database.backup', { path: join(recovery, 'original.db') });
      await mkdir(join(this.options.dataDir, 'assets'), { recursive: true, mode: 0o700 });
      const staged: string[] = [];
      try {
        for (const asset of archive.snapshot.assets.filter(a => a.kind === 'copy')) {
          asset.storageName = `${randomUUID()}.enc`;
          const destination = join(this.options.dataDir, 'assets', asset.storageName);
          await atomicPrivateWrite(destination, encryptPayload(Buffer.from(archive.assets[asset.id], 'base64'), this.options.key));
          staged.push(destination);
        }
        await atomicPrivateWrite(join(recovery, 'restore-manifest.enc'), encryptPayload(JSON.stringify({ status: 'prepared', staged, preparedAt: new Date().toISOString() }), this.options.key));
      } catch (error) { await Promise.all(staged.map(p => rm(p, { force: true }))); throw error; }
      // SQLite commits the validated graph atomically. Assets are present before commit;
      // preserve staging on an uncertain worker result rather than break a committed graph.
      await this.options.request('workspace.import', { snapshot: archive.snapshot });
      await atomicPrivateWrite(join(recovery, 'restore-manifest.enc'), encryptPayload(JSON.stringify({ status: 'committed', staged, committedAt: new Date().toISOString() }), this.options.key));
      return this.options.request('workspace.get');
    }
    throw new Error('Unknown backup method');
  }
  async daily(): Promise<void> {
    const operation = this.operations.then(async () => {
      const snapshot = await this.options.request('workspace.get') as WorkspaceSnapshot;
      if (!snapshot.settings.backupEnabled || (snapshot.settings.backupLastAt && localDay(new Date(snapshot.settings.backupLastAt)) === localDay(new Date()))) return;
      await this.create();
    });
    this.operations = operation.catch(() => {});
    await operation;
  }
}
