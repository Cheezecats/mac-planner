import Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  chmodSync,
  openSync,
  closeSync,
} from "node:fs";
import type { WorkspaceSnapshot } from "../shared/types";
import { createEmptyWorkspace, validateWorkspace } from "./domain";

export interface RecordChange {
  collection: "pages" | "entries" | "studies" | "widgets" | "assets";
  id: string;
  before: unknown;
  after: unknown;
}
export interface HistoryEntry {
  id: string;
  pageId: string;
  method: string;
  changes: RecordChange[];
  undone: boolean;
}
export interface RepositoryLike {
  getSnapshot(): WorkspaceSnapshot;
  replaceSnapshot(snapshot: WorkspaceSnapshot): void;
  getHistory?(): HistoryEntry[];
  commitSnapshot?(snapshot: WorkspaceSnapshot, history: HistoryEntry[]): void;
}
interface StoredState {
  snapshot: WorkspaceSnapshot;
  history: HistoryEntry[];
}
const AAD = Buffer.from("planner:encrypted-payload:v1");
/** Binary envelope: format byte, random 96-bit nonce, 128-bit GCM tag, ciphertext. */
export function encryptPayload(data: Buffer | string, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
}
export function decryptPayload(payload: Buffer, key: Buffer): Buffer {
  if (key.length !== 32 || payload.length < 29 || payload[0] !== 1)
    throw new Error("Invalid encrypted payload");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      payload.subarray(1, 13),
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(payload.subarray(13, 29));
    return Buffer.concat([
      decipher.update(payload.subarray(29)),
      decipher.final(),
    ]);
  } catch {
    throw new Error(
      "Unable to decrypt workspace: incorrect key or damaged data",
    );
  }
}
export class EncryptedRepository implements RepositoryLike {
  private database: Database.Database;
  private key: Buffer;
  private closed = false;
  constructor(databasePath: string, key: Buffer) {
    if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");
    this.key = Buffer.from(key);
    const existed = existsSync(databasePath);
    this.database = new Database(databasePath);
    try {
      const version = this.database.pragma("user_version", {
        simple: true,
      }) as number;
      if (version > 1)
        throw new Error(
          "Unsupported database schema version; original preserved",
        );
      const tables = this.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as { name: string }[];
      if (tables.some((t) => t.name !== "workspace"))
        throw new Error("Unrecognized database schema; original preserved");
      const hasPayload = !!this.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace'",
        )
        .get();
      if (hasPayload) {
        const state = this.readState();
        validateWorkspace(state.snapshot);
      } else if (existed && version !== 0)
        throw new Error("Damaged workspace schema; original preserved");
      if (version < 1) {
        if (existed)
          copyFileSync(
            databasePath,
            `${databasePath}.pre-migration-${Date.now()}.bak`,
          );
        this.database.transaction(() => {
          this.database.exec(
            "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), payload BLOB NOT NULL)",
          );
          if (!hasPayload)
            this.writeState({ snapshot: createEmptyWorkspace(), history: [] });
          this.database.pragma("user_version = 1");
        })();
      }
      this.database.pragma("journal_mode = DELETE");
      this.database.pragma("secure_delete = ON");
      if (databasePath !== ":memory:") chmodSync(databasePath, 0o600);
    } catch (error) {
      this.database.close();
      this.key.fill(0);
      throw error;
    }
  }
  private readState(): StoredState {
    const row = this.database
      .prepare("SELECT payload FROM workspace WHERE id=1")
      .get() as { payload: Buffer } | undefined;
    if (!row) throw new Error("Missing encrypted workspace");
    const parsed = JSON.parse(
      decryptPayload(row.payload, this.key).toString("utf8"),
    ) as StoredState;
    if (!parsed.snapshot || !Array.isArray(parsed.history))
      throw new Error("Invalid encrypted workspace");
    return parsed;
  }
  private writeState(state: StoredState): void {
    const encrypted = encryptPayload(JSON.stringify(state), this.key);
    this.database
      .prepare(
        "INSERT INTO workspace(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(encrypted);
  }
  getSnapshot(): WorkspaceSnapshot {
    return this.readState().snapshot;
  }
  getHistory(): HistoryEntry[] {
    return this.readState().history;
  }
  replaceSnapshot(snapshot: WorkspaceSnapshot): void {
    this.commitSnapshot(snapshot, []);
  }
  /** One SQLite transaction persists the graph and encrypted per-record undo journal together. */
  commitSnapshot(snapshot: WorkspaceSnapshot, history: HistoryEntry[]): void {
    validateWorkspace(snapshot);
    this.database.transaction(() => this.writeState({ snapshot, history }))();
  }
  /** Online SQLite backup preserves the encrypted payload and its undo history. The destination must be new. */
  async backupTo(path: string): Promise<void> {
    if (this.closed) throw new Error("Repository is closed");
    const descriptor = openSync(path, "wx", 0o600);
    closeSync(descriptor);
    await this.database.backup(path);
    chmodSync(path, 0o600);
  }
  close(): void {
    if (!this.closed) {
      this.database.close();
      this.key.fill(0);
      this.closed = true;
    }
  }
}
