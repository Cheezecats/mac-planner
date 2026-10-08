import { dialog, shell, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, stat, realpath, opendir, mkdtemp, open, lstat, readdir, chmod } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { encryptPayload, decryptPayload } from '../core/repository';
import { safeAssetName, MAX_ASSET_BYTES } from './archive';
import type { AssetRecord, PageBlock, WorkspaceSnapshot } from '../shared/types';

export type NativeRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
export interface NativeOptions { request: NativeRequest; key: Buffer; dataDir: string; getWindow: () => BrowserWindow | null | undefined }
export async function chooseOpen(options: NativeOptions, details: OpenDialogOptions): Promise<string | null> {
  const parent = options.getWindow();
  const result = parent ? await dialog.showOpenDialog(parent, details) : await dialog.showOpenDialog(details);
  return result.canceled ? null : result.filePaths[0] ?? null;
}
export async function chooseSave(options: NativeOptions, details: SaveDialogOptions): Promise<string | null> {
  const parent = options.getWindow();
  const result = parent ? await dialog.showSaveDialog(parent, details) : await dialog.showSaveDialog(details);
  return result.canceled ? null : result.filePath ?? null;
}
export async function atomicPrivateWrite(path: string, bytes: Buffer | string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  finally { await rm(temporary, { force: true }); }
}
export async function boundedRead(path: string, maximum: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maximum) throw new Error('Source exceeds size limit');
    const buffer = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) return buffer.subarray(0, offset);
      offset += bytesRead;
    }
    throw new Error('Source changed while reading; try again');
  } finally { await file.close(); }
}
export function validateDocxExpansion(bytes: Buffer): void {
  const limit = 64 * 1024 * 1024;
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0) throw new Error('Invalid DOCX archive');
  const entries = bytes.readUInt16LE(eocd + 10), size = bytes.readUInt32LE(eocd + 12), start = bytes.readUInt32LE(eocd + 16);
  if (entries > 4096 || size === 0xffffffff || start === 0xffffffff || start + size > eocd) throw new Error('DOCX archive exceeds extraction limits');
  let offset = start, expanded = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid DOCX directory');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10), compressed = bytes.readUInt32LE(offset + 20), uncompressed = bytes.readUInt32LE(offset + 24), local = bytes.readUInt32LE(offset + 42);
    expanded += uncompressed;
    if (flags & 1 || ![0, 8].includes(method) || expanded > limit || compressed === 0xffffffff || local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('DOCX archive exceeds extraction limits');
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (dataStart + compressed > start) throw new Error('Invalid DOCX compressed entry');
    const data = bytes.subarray(dataStart, dataStart + compressed);
    const unpacked = method === 8 ? inflateRawSync(data, { maxOutputLength: Math.max(1, uncompressed) }) : data;
    if (unpacked.length !== uncompressed) throw new Error('DOCX entry size mismatch');
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  if (offset !== start + size) throw new Error('Invalid DOCX directory size');
}
const mimes: Record<string, string> = { '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
function mime(name: string): string { return mimes[extname(name).toLowerCase()] ?? 'application/octet-stream'; }
function richText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(richText).join('');
  if (value && typeof value === 'object') { const v = value as Record<string, unknown>; return typeof v.text === 'string' ? v.text : richText(v.content); }
  return '';
}
export function blocksToMarkdown(blocks: PageBlock[]): string {
  return blocks.map(block => {
    const text = richText(block.content), props = block.props;
    let line = text;
    if (block.type === 'heading') line = `${'#'.repeat(Math.min(6, Math.max(1, Number(props.level) || 1)))} ${text}`;
    else if (block.type === 'bulletListItem') line = `- ${text}`;
    else if (block.type === 'numberedListItem') line = `1. ${text}`;
    else if (block.type === 'checkListItem' || block.type === 'checklist') line = `- [${props.checked ? 'x' : ' '}] ${text}`;
    else if (block.type === 'codeBlock' || block.type === 'code') line = `\`\`\`${String(props.language ?? '')}\n${text}\n\`\`\``;
    else if (['file', 'image', 'folder', 'asset'].includes(block.type)) line = `[${String(props.name ?? 'Attachment')}] (asset ${String(props.assetId ?? '')})`;
    else if (block.type === 'equation') line = `$$\n${text || String(props.formula ?? '')}\n$$`;
    else if (!['paragraph', 'toggle', 'quote'].includes(block.type) && !text) line = `\`\`\`json\n${JSON.stringify(block, null, 2)}\n\`\`\``;
    if (block.children?.length) line += `\n${blocksToMarkdown(block.children).split('\n').map(s => `  ${s}`).join('\n')}`;
    return line;
  }).join('\n\n');
}
export class NativeFiles {
  private grants: Record<string, string> = {};
  private loaded?: Promise<void>;
  private initialized?: Promise<void>;
  private temporaryDirectory?: Promise<string>;
  private opened = new Map<string,Set<string>>();
  constructor(private readonly options: NativeOptions) {}
  async initialize(): Promise<void> {
    this.initialized ??= (async () => {
      const root = join(this.options.dataDir, 'temporary-open-files');
      await mkdir(root, { recursive: true, mode: 0o700 });
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Temporary attachment folder is invalid');
      await chmod(root, 0o700);
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^session-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
        const directory = join(root, entry.name);
        let owned = false;
        try { owned = (await readFile(join(directory, '.planner-opened-copy'), 'utf8')) === 'Planner opened copies v1\n'; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (owned) await rm(directory, { recursive: true, force: true });
      }
    })();
    await this.initialized;
  }
  private async temporaryRoot(): Promise<string> {
    await this.initialize();
    this.temporaryDirectory ??= (async () => {
      const directory = await mkdtemp(join(this.options.dataDir, 'temporary-open-files', 'session-'));
      await writeFile(join(directory, '.planner-opened-copy'), 'Planner opened copies v1\n', { mode: 0o600, flag: 'wx' });
      return directory;
    })();
    return this.temporaryDirectory;
  }
  private async loadGrants(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const value = JSON.parse(decryptPayload(await readFile(join(this.options.dataDir, 'file-grants.enc')), this.options.key).toString());
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => typeof v !== 'string')) throw new Error('Invalid file permissions');
        this.grants = value;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    })();
    await this.loaded;
  }
  private async grant(id: string, path: string): Promise<void> {
    await this.loadGrants();
    const grants = { ...this.grants, [id]: path };
    await atomicPrivateWrite(join(this.options.dataDir, 'file-grants.enc'), encryptPayload(JSON.stringify(grants), this.options.key));
    this.grants = grants;
  }
  private async asset(id: unknown): Promise<AssetRecord> {
    const snapshot = await this.options.request('workspace.get') as WorkspaceSnapshot;
    const asset = snapshot.assets.find(a => a.id === id);
    if (!asset) throw new Error('Attachment not found');
    return asset;
  }
  private async sourcePath(asset: AssetRecord): Promise<string> {
    await this.loadGrants();
    if (!asset.originalPath || this.grants[asset.id] !== asset.originalPath) throw new Error('Source needs permission. Use Locate to select it.');
    try { if (await realpath(asset.originalPath) !== asset.originalPath) throw new Error('Source has changed. Use Locate.'); await stat(asset.originalPath); }
    catch { throw new Error('Source is missing or changed. Use Locate to select it.'); }
    return asset.originalPath;
  }
  async bytes(asset: AssetRecord, maximum = MAX_ASSET_BYTES): Promise<Buffer> {
    if (asset.kind === 'folder-link') throw new Error('Select a file to read its contents');
    const path = asset.kind === 'copy' ? join(this.options.dataDir, 'assets', safeAssetName(asset.storageName ?? '')) : await this.sourcePath(asset);
    const info = await stat(path).catch(() => { throw new Error('Attachment is missing. Use Locate for linked files.'); });
    if (!info.isFile() || info.size > maximum + (asset.kind === 'copy' ? 29 : 0)) throw new Error('Attachment exceeds the reading size limit');
    const stored = await boundedRead(path, maximum + (asset.kind === 'copy' ? 29 : 0));
    const result = asset.kind === 'copy' ? decryptPayload(stored, this.options.key) : stored;
    if (result.length > maximum) throw new Error('Attachment exceeds the reading size limit');
    return result;
  }
  async handle(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'file.attach' || method === 'file.link') {
      const state = await this.options.request('workspace.get') as WorkspaceSnapshot;
      if (!state.pages.some(p => p.id === params.pageId && p.status !== 'trashed')) throw new Error('Select an existing page');
      const folder = params.folder === true;
      const selected = await chooseOpen(this.options, { title: method === 'file.attach' ? 'Attach a file' : 'Link a source', properties: [folder ? 'openDirectory' : 'openFile'] });
      if (!selected) return null;
      const path = await realpath(selected), info = await stat(path);
      if (folder ? !info.isDirectory() : !info.isFile()) throw new Error('Choose the requested source type');
      const id = randomUUID(), copy = method === 'file.attach' && !folder;
      const record: AssetRecord = { id, pageId: String(params.pageId), name: basename(path), kind: copy ? 'copy' : folder ? 'folder-link' : 'file-link', mime: folder ? 'inode/directory' : mime(path), size: folder ? 0 : info.size };
      if (copy) {
        if (info.size > MAX_ASSET_BYTES) throw new Error('Attachment exceeds 128 MB');
        record.storageName = `${id}.enc`;
        await mkdir(join(this.options.dataDir, 'assets'), { recursive: true, mode: 0o700 });
        const bytes = await boundedRead(path, MAX_ASSET_BYTES);
        record.size = bytes.length;
        await atomicPrivateWrite(join(this.options.dataDir, 'assets', record.storageName), encryptPayload(bytes, this.options.key));
      } else { record.originalPath = path; await this.grant(id, path); }
      try { return await this.options.request('asset.save', { record }); }
      catch (error) { if (copy) await rm(join(this.options.dataDir, 'assets', record.storageName!), { force: true }); throw error; }
    }
    if (method === 'export.markdown') {
      const snapshot = await this.options.request('workspace.get') as WorkspaceSnapshot;
      const page = snapshot.pages.find(p => p.id === params.id);
      if (!page) throw new Error('Page not found');
      const path = await chooseSave(this.options, { title: 'Export page', defaultPath: `${page.title.replace(/[/\\]/g, '-') || 'Untitled'}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (!path) return null;
      await atomicPrivateWrite(path, `# ${page.title}\n\n${blocksToMarkdown(page.blocks)}\n`);
      return { saved: true };
    }
    const asset = await this.asset(params.id);
    if (method === 'file.locate') {
      if (asset.kind === 'copy') throw new Error('Copied attachments are stored in the workspace');
      const selected = await chooseOpen(this.options, { title: 'Locate linked source', properties: [asset.kind === 'folder-link' ? 'openDirectory' : 'openFile'] });
      if (!selected) return null;
      const path = await realpath(selected), info = await stat(path);
      if (asset.kind === 'folder-link' ? !info.isDirectory() : !info.isFile()) throw new Error('Choose the requested source type');
      await this.grant(asset.id, path);
      return this.options.request('asset.save', { record: { ...asset, originalPath: path, name: basename(path), mime: asset.kind === 'folder-link' ? 'inode/directory' : mime(path), size: asset.kind === 'folder-link' ? 0 : info.size } });
    }
    if (method === 'file.open') {
      let path: string;
      if (asset.kind === 'copy') {
        const dir = join(await this.temporaryRoot(), randomUUID());
        await mkdir(dir, { mode: 0o700 });
        const paths=this.opened.get(asset.id)??new Set<string>();paths.add(dir);this.opened.set(asset.id,paths);
        path = join(dir, basename(asset.name));
        await writeFile(path, await this.bytes(asset), { flag: 'wx', mode: 0o600 });
      } else path = await this.sourcePath(asset);
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
      return { opened: true };
    }
    if (method === 'file.preview') {
      const bytes = await this.bytes(asset, 20 * 1024 * 1024);
      let type: string | undefined;
      if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) type = 'image/png';
      else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) type = 'image/jpeg';
      else if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0,6).toString())) type = 'image/gif';
      else if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') type = 'image/webp';
      if (!type) throw new Error('Preview supports PNG, JPEG, GIF and WebP images');
      return { url: `data:${type};base64,${bytes.toString('base64')}` };
    }
    if (method === 'file.read') {
      if (asset.kind === 'folder-link') {
        const names: string[] = [];
        for await (const entry of await opendir(await this.sourcePath(asset))) { names.push(entry.name); if (names.length >= 1000) break; }
        return names.join('\n').slice(0, 100000);
      }
      const bytes = await this.bytes(asset, 20 * 1024 * 1024), extension = extname(asset.name).toLowerCase();
      if (extension === '.docx') {
        validateDocxExpansion(bytes);
        const mammoth = await import('mammoth');
        return (await mammoth.extractRawText({ buffer: bytes })).value.slice(0, 200000);
      }
      if (extension === '.pdf') {
        const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const resolveModule = createRequire(typeof __filename === 'string' ? __filename : join(process.cwd(), 'package.json'));
        const packageRoot = dirname(resolveModule.resolve('pdfjs-dist/package.json'));
        const loading = pdf.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, stopAtErrors: true, standardFontDataUrl: join(packageRoot, 'standard_fonts') + '/', cMapUrl: join(packageRoot, 'cmaps') + '/', cMapPacked: true });
        try {
          const document = await loading.promise;
          let text = '';
          for (let i = 1; i <= Math.min(document.numPages, 100) && text.length < 200000; i++) {
            const page = await document.getPage(i), content = await page.getTextContent();
            text += content.items.map(item => 'str' in item ? item.str : '').join(' ') + '\n';
            page.cleanup();
          }
          return text.slice(0, 200000);
        } finally { await loading.destroy(); }
      }
      const textExtensions = /\.(txt|md|csv|tsv|json|html?|xml|css|[cm]?[jt]sx?|py|java|c|cpp|h|rs|go|rb|sh|yaml|yml|toml|tex|log)$/i;
      if (!textExtensions.test(asset.name) && !asset.mime.startsWith('text/')) throw new Error('Text extraction supports text, code, DOCX and PDF files');
      if (bytes.includes(0)) throw new Error('Source is binary, not a text document');
      return bytes.toString('utf8').slice(0, 200000);
    }
    throw new Error('Unknown file method');
  }
  async dispose(): Promise<void> { if (this.temporaryDirectory) await rm(await this.temporaryDirectory, { recursive: true, force: true }); this.temporaryDirectory = undefined; this.opened.clear(); }
  async purgeAssets(removed:AssetRecord[],remaining:AssetRecord[]):Promise<void>{
    await this.loadGrants();
    const keep=new Set(remaining.filter(a=>a.kind==='copy').map(a=>a.storageName));
    for(const asset of removed){if(asset.kind==='copy'&&asset.storageName&&!keep.has(asset.storageName))await rm(join(this.options.dataDir,'assets',safeAssetName(asset.storageName)),{force:true});for(const path of this.opened.get(asset.id)??[])await rm(path,{recursive:true,force:true});this.opened.delete(asset.id);delete this.grants[asset.id]}
    await atomicPrivateWrite(join(this.options.dataDir,'file-grants.enc'),encryptPayload(JSON.stringify(this.grants),this.options.key));
  }
}
