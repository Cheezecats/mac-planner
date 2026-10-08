import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { validateWorkspace } from '../core/domain';
import type { AssetRecord, WorkspaceSnapshot } from '../shared/types';

export interface PortableArchive { snapshot: WorkspaceSnapshot; assets: Record<string, string> }
export const MAX_ASSET_BYTES = 128 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAGIC = Buffer.from('PLANNER-ARCHIVE');
const HEADER_BYTES = MAGIC.length + 1 + 32 + 12;
export function safeAssetName(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/.test(name) || name === '.' || name === '..') throw new Error('Unsafe archive asset identifier');
  return name;
}
export function portableSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  validateWorkspace(snapshot);
  const { pages, entries, labels, studies, widgets, assets, settings } = structuredClone(snapshot);
  const cleanSettings = {
    view: settings.view, sidebarExpanded: settings.sidebarExpanded, textScale: settings.textScale,
    calendarView: settings.calendarView, weekStartsOn: settings.weekStartsOn,
    backupEnabled: false, reducedMotion: settings.reducedMotion, onboardingDismissed: settings.onboardingDismissed,
  };
  return { schemaVersion: 1, pages, entries, labels, studies, widgets, assets, settings: cleanSettings, connections: [], suggestions: [], importedEvents: [] };
}
export function validateArchiveAssets(assets: unknown, records: AssetRecord[]): asserts assets is Record<string, string> {
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) throw new Error('Invalid archive assets');
  let total = 0;
  for (const [id, content] of Object.entries(assets)) {
    safeAssetName(id);
    if (typeof content !== 'string' || content.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) throw new Error('Invalid archive asset bytes');
    const bytes = Buffer.from(content, 'base64');
    if (bytes.toString('base64') !== content || bytes.length > MAX_ASSET_BYTES) throw new Error('Invalid archive asset bytes');
    total += bytes.length;
    if (total > MAX_ARCHIVE_BYTES) throw new Error('Archive assets exceed size limit');
  }
  for (const record of records) {
    safeAssetName(record.id);
    if (record.storageName) safeAssetName(record.storageName);
    if (record.kind === 'copy') {
      if (!Object.hasOwn(assets, record.id)) throw new Error('Missing copied archive asset');
      const content = (assets as Record<string, string>)[record.id];
      if (Buffer.from(content, 'base64').length !== record.size) throw new Error('Copied archive asset size mismatch');
    }
  }
}
function derive(password: string, salt: Buffer): Buffer {
  if (typeof password !== 'string' || password.length < 8 || password.length > 4096) throw new Error('Use a backup passphrase of at least eight characters');
  return scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
export function sealArchive(archive: PortableArchive, password: string): Buffer {
  const snapshot = portableSnapshot(archive.snapshot);
  validateArchiveAssets(archive.assets, snapshot.assets);
  const bytes = Buffer.from(JSON.stringify({ snapshot, assets: archive.assets }));
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds size limit');
  const salt = randomBytes(32), nonce = randomBytes(12), key = derive(password, salt);
  try {
    const header = Buffer.concat([MAGIC, Buffer.from([1]), salt, nonce]);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(header);
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([header, cipher.getAuthTag(), ciphertext]);
  } finally { key.fill(0); }
}
export function openArchive(bytes: Buffer, password: string): PortableArchive {
  if (bytes.length < HEADER_BYTES + 16 || bytes.length > MAX_ARCHIVE_BYTES + HEADER_BYTES + 16 || !bytes.subarray(0, MAGIC.length).equals(MAGIC) || bytes[MAGIC.length] !== 1) throw new Error('Unsupported or damaged archive; original workspace preserved');
  const key = derive(password, bytes.subarray(MAGIC.length + 1, MAGIC.length + 33));
  let parsed: PortableArchive;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(HEADER_BYTES - 12, HEADER_BYTES));
    decipher.setAAD(bytes.subarray(0, HEADER_BYTES));
    decipher.setAuthTag(bytes.subarray(HEADER_BYTES, HEADER_BYTES + 16));
    parsed = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(HEADER_BYTES + 16)), decipher.final()]).toString('utf8'));
  } catch { throw new Error('Incorrect backup passphrase or damaged archive; original workspace preserved'); }
  finally { key.fill(0); }
  validateWorkspace(parsed.snapshot);
  validateArchiveAssets(parsed.assets, parsed.snapshot.assets);
  parsed.snapshot = portableSnapshot(parsed.snapshot);
  return parsed;
}
