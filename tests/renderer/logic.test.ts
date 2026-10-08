import { describe, it, expect } from 'vitest';
import { monthDays, weekDays, blockText, filterPages, prepareEditorBlocks, restoreUnknownBlocks, clampPopup, SerializedSaver } from '../../src/renderer/logic';

describe('calendar presentation', () => {
  it('shows a Monday-first grid including every date in a six-week month', () => {
    const days = monthDays('2026-08-15');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-07-27');
    expect(days.at(-1)).toBe('2026-09-06');
    expect(days).toContain('2026-08-31');
  });
  it('keeps the selected Sunday within its preceding Monday week', () => {
    expect(weekDays('2026-10-11')).toEqual(['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11']);
  });
  it('clamps an upward date stack to the visible viewport', () => {
    expect(clampPopup({left:990,top:700,width:100,height:32}, 320,280,{width:1100,height:800})).toEqual({left:768,top:412});
  });
});
describe('page search and editing preservation', () => {
  it('finds nested writing without matching private metadata', () => {
    const page:any={title:'Exam',labels:['Physics'],status:'active',blocks:[{id:'a',type:'paragraph',props:{secret:'token'},content:[{type:'text',text:'Momentum'}],children:[{id:'b',type:'paragraph',props:{},content:[{type:'text',text:'Collision'}]}]}]};
    expect(blockText(page.blocks)).toContain('Collision');
    expect(filterPages([page], 'collision')).toHaveLength(1);
    expect(filterPages([page], 'token')).toHaveLength(0);
  });
  it('keeps unsupported block payloads through a rich editor round trip', () => {
    const original:any=[{id:'a',type:'future-extension',props:{value:2},content:{unrecognized:true},children:[]}];
    const editor=prepareEditorBlocks(original, new Set(['paragraph']));
    expect(editor[0].type).toBe('unsupported');
    expect(restoreUnknownBlocks(editor, original)).toEqual(original);
  });
  it('duplicates an unsupported block without losing its opaque payload or repeating child IDs', () => {
    const original:any=[{id:'future',type:'future-extension',props:{value:2},content:{unrecognized:true},children:[{id:'nested',type:'future-child',props:{formula:'x'},content:{points:[1,2]}}]}];
    const placeholder=prepareEditorBlocks(original,new Set(['paragraph']))[0];
    const restored=restoreUnknownBlocks([{...placeholder,id:'duplicate'}],original)[0];
    expect(restored.type).toBe('future-extension');
    expect(restored.props).toEqual({value:2});
    expect(restored.content).toEqual({unrecognized:true});
    expect(restored.children?.[0].content).toEqual({points:[1,2]});
    expect(restored.children?.[0].id).not.toBe('nested');
    expect(restored.id).toBe('duplicate');
  });
});
describe('serialized autosave', () => {
  it('never submits concurrent writes and saves the latest edit after the first completes', async () => {
    const calls:string[]=[]; let release!:()=>void;
    const saver=new SerializedSaver(async (value:string)=>{calls.push(value);if(value==='first') await new Promise<void>(r=>release=r)});
    const first=saver.push('first');
    const second=saver.push('second');
    const third=saver.push('third');
    expect(calls).toEqual(['first']); release();
    await Promise.all([first,second,third]);
    expect(calls).toEqual(['first','third']);
  });
});

describe('browser tool confinement', () => {
  it('puts a network-denying policy before untrusted source and removes source overrides', async () => {
    const { safePreviewToolSource }=await import('../../src/renderer/tool-policy');
    const safe=safePreviewToolSource('<meta http-equiv="refresh" content="0;url=https://outside.test"><script>fetch("https://outside.test")</script>');
    expect(safe.indexOf("connect-src 'none'")).toBeLessThan(safe.indexOf('<script>'));
    expect(safe).not.toContain('http-equiv="refresh"');
    expect(safe).toContain("frame-src 'none'");
  });
});
