import {it,expect} from 'vitest';
import {createPlannerMenus,NativeCommandQueue} from '../../src/electron/native-ui';
import type {AppEvent} from '../../src/shared/types';

it('queues native commands until a renderer subscribes, then emits each in order',async()=>{
  const events:AppEvent[]=[],surfaces:string[]=[];
  const queue=new NativeCommandQueue(async()=>{surfaces.push('shown and focused')},event=>events.push(event));
  await queue.dispatch('new-page');await queue.dispatch('search');
  expect(events).toEqual([]);expect(surfaces).toHaveLength(2);
  queue.setReady(true);
  expect(events).toEqual([{type:'ui-command',data:{command:'new-page'}},{type:'ui-command',data:{command:'search'}}]);
  queue.setReady(false);await queue.dispatch('settings');expect(events).toHaveLength(2);
  queue.setReady(true);expect(events.at(-1)).toEqual({type:'ui-command',data:{command:'settings'}});
});
it('application and tray actions use the same renderer command path and standard Mac window roles',async()=>{
  const commands:string[]=[];
  const menus=createPlannerMenus(async command=>{commands.push(command)},()=>{},()=>{});
  const flat=menus.application.flatMap(item=>Array.isArray(item.submenu)?item.submenu:[]);
  for(const label of ['New Page','Search','Settings…','Today','Back','Forward']){
    const item=flat.find(item=>item.label===label)!;expect(item).toBeDefined();await (item.click as ()=>Promise<void>)();
  }
  expect(commands).toEqual(['new-page','search','settings','today','back','forward']);
  expect(flat.find(item=>item.label==='New Page')?.accelerator).toBe('CommandOrControl+N');
  expect(flat.find(item=>item.label==='Search')?.accelerator).toBe('CommandOrControl+K');
  expect(flat.find(item=>item.label==='Settings…')?.accelerator).toBe('CommandOrControl+,');
  // Back/Forward intentionally avoid editor indent and cursor navigation shortcuts.
  expect(flat.find(item=>item.label==='Back')?.accelerator).toBeUndefined();
  expect(flat.find(item=>item.label==='Forward')?.accelerator).toBeUndefined();
  expect(flat.map(item=>item.role)).toEqual(expect.arrayContaining(['minimize','zoom','front']));
  await (menus.tray.find(item=>item.label==='New Page')!.click as ()=>Promise<void>)();expect(commands.at(-1)).toBe('new-page');
});
