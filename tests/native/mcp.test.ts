import { it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyWorkspace } from '../../src/core/domain';
import { PlannerService } from '../../src/core/service';
import { startCompanion } from '../../src/electron/companion';
const registered = vi.hoisted(() => new Map<string, { options: any; callback: (args: any) => Promise<any> }>());
vi.mock('@modelcontextprotocol/server', () => ({ McpServer: class { registerTool(name: string, options: any, callback: any) { registered.set(name, { options, callback }); } async connect() {} } }));
vi.mock('@modelcontextprotocol/server/stdio', () => ({ StdioServerTransport: class {} }));
it('registers reopen separately from undo and uses the live companion revision guards', async () => {
 const dir=await mkdtemp(join(tmpdir(),'planner-mcp-reopen-'));const old=process.env.PLANNER_DATA_DIR;process.env.PLANNER_DATA_DIR=dir;
 let snapshot=createEmptyWorkspace();const service=new PlannerService({getSnapshot:()=>structuredClone(snapshot),replaceSnapshot:s=>{snapshot=structuredClone(s)}});
 const server=await startCompanion(dir,async(method,params)=>service.execute(method,params));
 try {
  await import('../../src/electron/mcp');const tool=registered.get('reopen_page');expect(tool).toBeDefined();expect(registered.has('undo_page')).toBe(true);
  expect(tool!.options.description).toMatch(/explicit user request/);
  expect(tool!.options.inputSchema.safeParse({id:'p',expectedRevision:0}).success).toBe(false);
  let p=service.execute('page.create',{title:'Essay'}) as any;p=service.execute('page.complete',{id:p.id,expectedRevision:p.revision});
  const stale=await tool!.callback({id:p.id,expectedRevision:p.revision-1});expect(stale.isError).toBe(true);expect(stale.content[0].text).toMatch(/Revision conflict/);
  const result=await tool!.callback({id:p.id,expectedRevision:p.revision});expect(JSON.parse(result.content[0].text)).toMatchObject({page:{id:p.id,status:'active'},restoredEntryCount:0,skippedEntryCount:0});
 }finally{if(old===undefined)delete process.env.PLANNER_DATA_DIR;else process.env.PLANNER_DATA_DIR=old;await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true})}
});
