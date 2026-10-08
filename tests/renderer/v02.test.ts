import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyWorkspace } from '../../src/core/domain';
import { AppContext } from '../../src/renderer/ui';
import { SpaceView } from '../../src/renderer/Space';
import * as logic from '../../src/renderer/logic';

const page=(id:string,title:string,body:string,labels:string[]=[],updatedAt='2026-10-01')=>({id,title,blocks:[{id:'body',type:'paragraph',props:{},content:body}],labels,status:'active',updatedAt,pinned:false,pinOrder:0,deadline:null}) as any;
describe('workspace search',()=>{
  it('ranks titles before labels before writing, with recent matches first',()=>{
    const pages=[page('body','Other','mechanics',[],'2026-10-08'),page('label','Other','',['physics'],'2026-10-07'),page('old-title','Mechanics','',[],'2026-10-01'),page('new-title','Mechanics','',[],'2026-10-05')];
    expect(logic.filterPages(pages,'mechanics','','all',[{id:'physics',name:'Mechanics'}]).map(p=>p.id)).toEqual(['new-title','old-title','label','body']);
  });
  it('returns a bounded matching writing snippet without metadata or HTML execution',()=>{
    const p=page('snippet','Other','x'.repeat(200)+' <script>mechanics</script> '+ 'z'.repeat(200));
    p.blocks.push({id:'table',type:'table',props:{secret:'private'},content:{rows:[{cells:[[{type:'text',text:'visible cell'}]]}],secret:'private'}});
    expect(logic.blockText(p.blocks)).not.toContain('private');
    expect(logic.blockText(p.blocks)).toContain('visible cell');
    const snippet=(logic as any).searchSnippet(p,'mechanics',[]);
    expect(snippet).toContain('mechanics');expect(snippet.length).toBeLessThanOrEqual(164);
    expect(renderToStaticMarkup(createElement('span',null,snippet))).not.toContain('<script>');
  });
  it('selects the second result, bounds arrows and ignores composition Enter',()=>{
    const next=(logic as any).searchKeyAction;
    expect(next('ArrowDown',0,3,false)).toEqual({selected:1});
    expect(next('ArrowDown',2,3,false)).toEqual({selected:2});
    expect(next('ArrowUp',0,3,false)).toEqual({selected:0});
    expect(next('Enter',1,3,false)).toEqual({open:1});
    expect(next('Enter',1,3,true)).toEqual({});
    expect(next('Escape',1,3,false)).toEqual({close:true});
  });
});
describe('guarded visit history',()=>{
  it('supplies the destination actual back target before rendering each nested visit',async()=>{
    const frames:{page:string;back?:string}[]=[];
    const History=(logic as any).VisitHistory;
    const history=new History({view:'calendar'},async()=>{},async(visit:any,previous:any)=>{frames.push({page:visit.pageId??visit.view,back:previous?.pageId??previous?.view})});
    await history.visit({view:'calendar',pageId:'A'});
    await history.visit({view:'calendar',pageId:'B'});
    await history.back();await history.back();await history.forward();
    expect(frames).toEqual([{page:'A',back:'calendar'},{page:'B',back:'A'},{page:'A',back:'calendar'},{page:'calendar',back:undefined},{page:'A',back:'calendar'}]);
  });
  it('serializes native commands through the save guard and does not perform a command after a failed save',async()=>{
    let release!:()=>void;let fail=false;const performed:string[]=[];
    const pending=new Promise<void>(resolve=>release=resolve);
    const dispatch=(logic as any).createCommandDispatcher(async()=>{await pending;if(fail)throw new Error('Save failed')},{search:async()=>performed.push('search'),settings:async()=>performed.push('settings')});
    const searching=dispatch('search'),settings=dispatch('settings');expect(performed).toEqual([]);
    release();await searching;await settings;expect(performed).toEqual(['search','settings']);
    fail=true;await expect(dispatch('search')).rejects.toThrow('Save failed');expect(performed).toEqual(['search','settings']);
  });
  it('returns through nested pages to the actual view and its saved context and scroll',async()=>{
    const History=(logic as any).VisitHistory;
    const history=new History({view:'calendar',anchor:'2026-08-15',selected:'2026-08-23',scroll:250},async()=>{},async()=>{});
    await history.visit({view:'calendar',pageId:'parent',scroll:0});
    await history.visit({view:'calendar',pageId:'child',scroll:0});
    await history.back();expect(history.current.pageId).toBe('parent');
    await history.back();expect(history.current).toEqual({view:'calendar',anchor:'2026-08-15',selected:'2026-08-23',scroll:250});
    await history.forward();expect(history.current.pageId).toBe('parent');
  });
  it('leaves history and a failed editor buffer in place when the save guard rejects',async()=>{
    const History=(logic as any).VisitHistory;let fail=false;
    const history=new History({view:'space',tab:'all',query:'physics',label:'l',status:'completed',collapsed:['Ideas'],scroll:420},async()=>{if(fail)throw new Error('Save failed')},async()=>{});
    await history.visit({view:'space',pageId:'page',scroll:0});fail=true;
    await expect(history.back()).rejects.toThrow('Save failed');expect(history.current.pageId).toBe('page');
    fail=false;await history.back();expect(history.current.scroll).toBe(420);expect(history.current.status).toBe('completed');
  });
  it('does not consume the previous visit if changing the saved view fails',async()=>{
    const History=(logic as any).VisitHistory;let fail=false;
    const history=new History({view:'space'},async()=>{},async()=>{if(fail)throw new Error('Storage unavailable')});
    await history.visit({view:'space',pageId:'one'});fail=true;
    await expect(history.back()).rejects.toThrow('Storage unavailable');expect(history.current.pageId).toBe('one');
    fail=false;await history.back();expect(history.current).toEqual({view:'space'});
  });
});
describe('settings feedback',()=>{
  it('distinguishes cancelled backups and useful native information from raw object strings',()=>{
    const feedback=(logic as any).operationFeedback;
    expect(feedback('backup.create',{cancelled:true})).toMatch(/cancel/i);
    expect(feedback('app.notificationsStatus',{supported:false,verifiedDelivery:false,message:'No delivery support'})).toContain('No delivery support');
    const companion=feedback('app.companionInfo',{name:'Companion',socket:'/local/socket',instructions:'Keep Planner running.'});
    expect(companion).toContain('Keep Planner running.');expect(companion).not.toContain('[object Object]');
  });
});
describe('Reopen boundary',()=>{
  it('saves pending edits first and uses the updated revision for Reopen without invoking Undo',async()=>{
    let revision=2;const operations:string[]=[];let notice='';
    const reopen=(logic as any).reopenSavedPage;
    const restored=await reopen(async()=>{revision=3;operations.push('save')},async(method:string,params:any)=>{expect(params).toEqual({id:'page',expectedRevision:3});operations.push(method);return {page:{id:'page',revision:4},restoredEntryCount:1,skippedEntryCount:1,message:'Page reopened. One changed session was kept.'}},'page',()=>revision,(message:string)=>notice=message);
    expect(operations).toEqual(['save','page.reopen']);expect(restored.revision).toBe(4);expect(notice).toContain('changed session');
  });
});
describe('Focus clarity',()=>{
  it('shows status filters only in All items and provides a way to find undated ideas',()=>{
    const snapshot=createEmptyWorkspace();snapshot.pages=[page('idea','Undated idea','Writing')];
    const context:any={snapshot,request:async()=>{},openPage:()=>{}};
    const html=renderToStaticMarkup(createElement(AppContext,{value:context},createElement(SpaceView,{createPage:()=>{}})));
    expect(html).not.toContain('Filter status');expect(html).toContain('View all items');
  });
  it('keeps Focus active-only even when All items previously used Completed',()=>{
    const snapshot=createEmptyWorkspace();snapshot.pages=[{...page('active','Open pinned item',''),pinned:true},{...page('done','Completed pinned item',''),pinned:true,status:'completed'}];
    const context:any={snapshot,request:async()=>{},openPage:()=>{}};
    const html=renderToStaticMarkup(createElement(AppContext,{value:context},createElement(SpaceView,{createPage:()=>{},context:{tab:'focus',search:'',label:'',status:'completed',collapsed:[]}})));
    expect(html).toContain('Open pinned item');expect(html).not.toContain('Completed pinned item');
  });
  it('keeps completed status filtering available in All items',()=>{
    const snapshot=createEmptyWorkspace();snapshot.pages=[page('active','Open item',''),{...page('done','Completed item',''),status:'completed'}];
    const context:any={snapshot,request:async()=>{},openPage:()=>{}};
    const html=renderToStaticMarkup(createElement(AppContext,{value:context},createElement(SpaceView,{createPage:()=>{},context:{tab:'all',search:'',label:'',status:'completed',collapsed:[]}})));
    expect(html).toContain('Filter status');expect(html).toContain('Completed item');expect(html).not.toContain('Open item');
  });
});
