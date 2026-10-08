import {it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {clampWindowBounds} from '../../src/electron/window-state';

it('the final Quit fixture fits a small hosted display and waits for native resizing before pending edits',async()=>{
  const source=await readFile('src/electron/smoke.ts','utf8');
  const start=source.indexOf('window.setSize(740,620)'),end=source.indexOf("await views.get(widget.id)!.webContents.executeJavaScript('for(let sequence=81",start);
  expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
  const workArea={x:0,y:25,width:1024,height:684},results:Record<string,unknown>={};
  let bounds={x:0,y:25,width:740,height:620};
  vi.useFakeTimers();try{
    const window={setSize:(width:number,height:number)=>{bounds={...bounds,width,height}},getNormalBounds:()=>({...bounds}),setBounds:(requested:typeof bounds)=>{setTimeout(()=>{bounds={...requested}},250)}};
    const finish=new Script(`(async()=>{${source.slice(start,end)}return window.getNormalBounds()})()`).runInNewContext({window,results,capture:async()=>{},screen:{getDisplayMatching:()=>({workArea})},clampWindowBounds,setTimeout});
    let finished=false;void finish.then(()=>{finished=true});
    await vi.advanceTimersByTimeAsync(200);expect(finished,'Final pending writes must wait for the native size to settle').toBe(false);
    await vi.advanceTimersByTimeAsync(1000);expect(await finish).toEqual(workArea);expect(results.quitWindowBounds).toEqual(workArea);
  }finally{vi.useRealTimers()}
});
