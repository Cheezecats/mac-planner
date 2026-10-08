import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EncryptedRepository } from '../core/repository';
import { PlannerService } from '../core/service';

type ParentPort = { on(event: 'message', callback: (event: { data: unknown }) => void): void; postMessage(message: unknown): void };
const port = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
let repository: EncryptedRepository | undefined;
let service: PlannerService | undefined;
let chain = Promise.resolve();
const allowed = /^(workspace\.(get|export|import)|page\.(create|resource|update|patch|complete|reopen|undo|duplicate|instantiate|archive|delete|restore|purge)|schedule\.(create|update|move|status|remove)|label\.(create|update|delete)|study\.save|widget\.save|asset\.(save|remove)|suggestion\.(upsert|accept|dismiss)|connection\.(save|remove)|calendar\.import|settings\.update)$/;
port?.on('message', ({ data }) => {
  chain = chain.then(async () => {
    const message = data as { type?: string; id?: string; dataDir?: string; key?: string; method?: string; params?: Record<string, unknown> };
    if (message.type === 'init') {
      try {
        if (repository || !message.dataDir || typeof message.key !== 'string') throw new Error('Invalid database initialization');
        const key = Buffer.from(message.key, 'base64');
        try {
          mkdirSync(message.dataDir, { recursive: true, mode: 0o700 });
          repository = new EncryptedRepository(join(message.dataDir, 'workspace.db'), key);
          service = new PlannerService(repository);
        } finally { key.fill(0); }
        port.postMessage({ type: 'ready' });
      } catch (error) { port.postMessage({ type: 'fatal', error: error instanceof Error ? error.message : 'Database initialization failed' }); }
      return;
    }
    if (message.type !== 'request') return;
    try {
      if (!repository || !service) throw new Error('Database is not ready');
      let result: unknown;
      if (message.method === 'database.close') {
        repository.close();repository=undefined;service=undefined;result={closed:true};
      } else if (message.method === 'database.backup') {
        if (typeof message.params?.path !== 'string') throw new Error('Backup destination required');
        await repository.backupTo(message.params.path);
        result = { path: message.params.path };
      } else if (message.method && allowed.test(message.method)) result = service.execute(message.method, message.params ?? {});
      else throw new Error('Unknown database method');
      port.postMessage({ type: 'result', id: message.id, result });
    } catch (error) { port.postMessage({ type: 'result', id: message.id, error: error instanceof Error ? error.message : 'Database request failed' }); }
  }).catch(() => {});
});
process.on('exit', () => repository?.close());
