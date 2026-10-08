import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Page, PlannerAPI, PlannerUICommand, View, WorkspaceSnapshot } from '../shared/types';
import { getAPI } from './api';
import { createCommandDispatcher, filterPages, localDate, searchKeyAction, searchSnippet, VisitHistory } from './logic';
import { AppContext, Icon, IconButton, Modal, type IconName } from './ui';
import { CalendarView, initialCalendarContext, type CalendarContext } from './Calendar';
import { SpaceView, initialSpaceContext, type SpaceContext } from './Space';
import { PageView } from './PageView';
import { ConnectionsView, SuggestionsView } from './Connections';
import { SettingsView } from './Settings';
import { AssistantPanel } from './Assistant';
const nav: {view:View;title:string;icon:IconName}[]=[{view:'calendar',title:'Calendar',icon:'CalendarIcon'},{view:'space',title:'Space',icon:'FileTextIcon'},{view:'suggestions',title:'Suggestions',icon:'DrawingPinIcon'},{view:'connections',title:'Connections',icon:'Link2Icon'},{view:'settings',title:'Settings',icon:'GearIcon'}];
interface Visit {view:View;pageId?:string;blockId?:string;scroll:number;calendar:CalendarContext;space:SpaceContext}
export function App(){
  const [api,setAPI]=useState<PlannerAPI|null>(null),[snapshot,setSnapshot]=useState<WorkspaceSnapshot|null>(null),[startupError,setStartupError]=useState(''),[committed,setCommitted]=useState<{visit:Visit;previous?:Visit}|null>(null),[assistant,setAssistant]=useState(false),[toast,setToast]=useState(''),[searchOpen,setSearchOpen]=useState(false),[search,setSearch]=useState(''),[searchSelected,setSearchSelected]=useState(0);
  const visit=committed?.visit??null;
  const [calendar,setCalendar]=useState(initialCalendarContext),[space,setSpace]=useState(initialSpaceContext);
  const navigationGuard=useRef<(()=>Promise<void>)|null>(null),main=useRef<HTMLElement>(null),searchReturnFocus=useRef<HTMLElement|null>(null),searchComposition=useRef(false);
  const latest=useRef(snapshot),calendarRef=useRef(calendar),spaceRef=useRef(space);latest.current=snapshot;calendarRef.current=calendar;spaceRef.current=space;
  const history=useRef<VisitHistory<Visit>|null>(null),dispatchRef=useRef<(command:PlannerUICommand)=>Promise<void>>(async()=>{});
  const notify=useCallback((message:string)=>setToast(message),[]);
  const refresh=useCallback(async()=>{if(api)setSnapshot(await api.request<WorkspaceSnapshot>('workspace.get'))},[api]);
  const request=useCallback(async<T,>(method:string,params?:Record<string,unknown>)=>{if(!api)throw new Error('Workspace not ready');try{const result=await api.request<T>(method,params);if(method!=='workspace.get')await refresh();return result}catch(error){notify(error instanceof Error?error.message:String(error));throw error}},[api,refresh,notify]);
  const requestRef=useRef(request);requestRef.current=request;
  if(snapshot&&!history.current){
    const initial:Visit={view:snapshot.settings.view,scroll:0,calendar,space};
    history.current=new VisitHistory(initial,async()=>{await navigationGuard.current?.()},async(next,previous)=>{
      if(latest.current?.settings.view!==next.view)await requestRef.current('settings.update',{changes:{view:next.view}});
      calendarRef.current=next.calendar;spaceRef.current=next.space;setCalendar(next.calendar);setSpace(next.space);setCommitted({visit:next,previous});
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    },current=>({...current,calendar:calendarRef.current,space:spaceRef.current,scroll:main.current?.scrollTop??0}));
  }
  const makeVisit=(view:View,pageId?:string,blockId?:string):Visit=>({view,pageId,blockId,scroll:0,calendar:calendarRef.current,space:spaceRef.current});
  const openPage=useCallback((id:string,blockId?:string)=>{const h=history.current;if(!h)return;if(h.current.pageId===id&&h.current.blockId===blockId)return;void h.visit(makeVisit(h.current.view,id,blockId)).catch(e=>notify(String(e)))},[notify]);
  const navigate=useCallback(async(next:View)=>{if(history.current)await history.current.visit(makeVisit(next))},[]);
  const goBack=useCallback(()=>{void history.current?.back().catch(e=>notify(String(e)))},[notify]);
  const createPage=useCallback(async()=>{await navigationGuard.current?.();const page=await request<Page>('page.create',{title:''});if(history.current)await history.current.visit(makeVisit(history.current.current.view,page.id))},[request]);
  const showSearch=()=>{if(!searchOpen){searchReturnFocus.current=document.activeElement as HTMLElement|null;setSearchSelected(0);setSearchOpen(true)}};
  const actions=useRef<Record<PlannerUICommand,()=>unknown>>({} as Record<PlannerUICommand,()=>unknown>);
  actions.current={'new-page':createPage,search:showSearch,settings:()=>navigate('settings'),today:async()=>{
    if(history.current)await history.current.visit({...makeVisit('calendar'),calendar:{...calendarRef.current,anchor:localDate(),selected:null,focusedDate:localDate()}});
  },back:()=>history.current?.back(),forward:()=>history.current?.forward()};
  const dispatcher=useRef<ReturnType<typeof createCommandDispatcher>|null>(null);
  if(!dispatcher.current)dispatcher.current=createCommandDispatcher(async()=>{await navigationGuard.current?.()},Object.fromEntries(['new-page','search','settings','today','back','forward'].map(command=>[command,()=>actions.current[command as PlannerUICommand]()])));
  dispatchRef.current=dispatcher.current;
  const command=(value:PlannerUICommand)=>{void dispatchRef.current(value).catch(e=>notify(e instanceof Error?e.message:String(e)))};
  useEffect(()=>{void getAPI().then(async bridge=>{setAPI(bridge);setSnapshot(await bridge.request<WorkspaceSnapshot>('workspace.get'))}).catch(e=>setStartupError(e instanceof Error?e.message:String(e)))},[]);
  useEffect(()=>{if(!api)return;const unsubscribe=api.subscribe(event=>{
    if(event.type==='flush-request'){const id=(event.data as any)?.id;void Promise.resolve(navigationGuard.current?.()).then(()=>api.request('app.flushReady',{id})).catch(error=>api.request('app.flushReady',{id,error:String(error)}));return}
    if(event.type==='ui-command'){command(event.data.command);return}
    if(event.type==='changed')void refresh().catch(e=>notify(String(e)));
    if(event.type==='open-page'&&event.pageId)openPage(event.pageId,(event.data as any)?.blockId);
    if(event.type==='widget-error')notify(event.text??'The interactive tool stopped with an error.');
  });return unsubscribe},[api,refresh,notify,openPage]);
  useEffect(()=>{if(!api?.isDesktop||!snapshot||!history.current)return;void api.request('app.rendererReady').catch(e=>notify(String(e)))},[api,Boolean(snapshot),notify]);
  useEffect(()=>{if(!api?.isDesktop)return;let visible=true;const update=()=>{const next=!Array.from(document.querySelectorAll('.modal-backdrop,.insert-menu,.date-stack,.page-action-menu,.popover-dismiss,.bn-suggestion-menu,.bn-formatting-toolbar,.bn-link-toolbar')).some(element=>element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden');if(next!==visible){visible=next;void api.request('widget.visibility',{visible}).catch(()=>{})}};const observer=new MutationObserver(update);observer.observe(document.body,{childList:true,subtree:true});update();return()=>observer.disconnect()},[api]);
  useLayoutEffect(()=>{if(main.current&&visit)main.current.scrollTop=visit.scroll},[visit]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),12000);return ()=>clearTimeout(timer)},[toast]);
  useEffect(()=>{const handle=(event:KeyboardEvent)=>{
    // Electron menu accelerators own these shortcuts on desktop.
    if(api?.isDesktop||event.defaultPrevented||event.isComposing||event.keyCode===229||!(event.metaKey||event.ctrlKey))return;
    const value=({k:'search',n:'new-page',',':'settings'} as Record<string,PlannerUICommand>)[event.key.toLowerCase()];
    if(value){event.preventDefault();command(value)}
  };window.addEventListener('keydown',handle);return ()=>window.removeEventListener('keydown',handle)},[api]);
  useEffect(()=>{document.getElementById('workspace-result-'+searchSelected)?.scrollIntoView({block:'nearest'})},[searchSelected]);
  if(!snapshot||!api)return <div className="startup"><h1>Planner</h1><p role="status">{startupError||'Opening your workspace…'}</p>{startupError&&<button onClick={()=>location.reload()}>Retry</button>}</div>;
  const expanded=snapshot.settings.sidebarExpanded,view=visit?.view??snapshot.settings.view,page=snapshot.pages.find(p=>p.id===visit?.pageId);
  const registerNavigationGuard=(guard:()=>Promise<void>)=>{navigationGuard.current=guard;return ()=>{if(navigationGuard.current===guard)navigationGuard.current=null}};
  const results=filterPages(snapshot.pages,search,'','all',snapshot.labels).slice(0,40),selected=Math.min(searchSelected,Math.max(0,results.length-1));
  const chooseResult=(index:number)=>{const result=results[index];if(!result)return;const h=history.current;if(!h)return;void h.visit(makeVisit(h.current.view,result.id)).then(()=>setSearchOpen(false)).catch(e=>notify(String(e)))};
  const previous=committed?.previous,backLabel=previous?.pageId?snapshot.pages.find(p=>p.id===previous.pageId)?.title||'Previous page':nav.find(n=>n.view===(previous?.view??view))?.title??'Previous view';
  return <AppContext.Provider value={{snapshot,api,request,openPage,refresh,notify,registerNavigationGuard,flushPage:async()=>{await navigationGuard.current?.()}}}><div className={`app ${expanded?'sidebar-expanded':''} ${snapshot.settings.reducedMotion?'reduced-motion':''}`} style={{'--text-scale':snapshot.settings.textScale} as React.CSSProperties}>
    <div className="titlebar"><span className="traffic-lights" aria-hidden="true"><i/><i/><i/></span><IconButton name="ColumnsIcon" label={expanded?'Collapse sidebar':'Expand sidebar'} onClick={()=>void request('settings.update',{changes:{sidebarExpanded:!expanded}}).catch(()=>{})}/><span className="titlebar-label">{api.isDesktop?'':'Browser preview · local editing only'}</span></div>
    <aside className="sidebar"><IconButton name="MagnifyingGlassIcon" label="Search workspace (⌘K)" onClick={()=>command('search')}/><div className="main-nav">{nav.slice(0,3).map(n=><button key={n.view} title={n.title} aria-label={n.title} className={view===n.view&&!page?'active':''} onClick={()=>void navigate(n.view).catch(e=>notify(String(e)))}><Icon name={n.icon}/>{expanded&&<span>{n.title}</span>}{n.view==='suggestions'&&snapshot.suggestions.some(s=>s.status==='pending')&&<i className="nav-dot"/>}</button>)}</div><div className="sidebar-bottom">{nav.slice(3).map(n=><button key={n.view} title={n.title} aria-label={n.title} className={view===n.view&&!page?'active':''} onClick={()=>void navigate(n.view).catch(e=>notify(String(e)))}><Icon name={n.icon}/>{expanded&&<span>{n.title}</span>}</button>)}<button title="Assistant" aria-label="Assistant" className={assistant?'active':''} onClick={()=>setAssistant(!assistant)}><Icon name="ChatBubbleIcon"/>{expanded&&<span>Assistant</span>}</button></div></aside>
    <main ref={main} className={`main-content ${page?'page-content':''}`}>{page?<PageView key={page.id} focusBlockId={visit?.blockId} page={page} onBack={goBack} backLabel={backLabel} onAssistant={()=>setAssistant(!assistant)}/>:view==='calendar'?<><CalendarView context={calendar} onContextChange={next=>{calendarRef.current=next;setCalendar(next)}}/><button className="calendar-new" onClick={()=>command('new-page')}><Icon name="PlusIcon"/>New</button></>:view==='space'?<SpaceView context={space} onContextChange={next=>{spaceRef.current=next;setSpace(next)}} createPage={()=>command('new-page')}/>:view==='connections'?<ConnectionsView/>:view==='suggestions'?<SuggestionsView/>:<SettingsView/>}</main>
    {assistant&&<AssistantPanel page={page} onClose={()=>setAssistant(false)}/>}
    {toast&&<div className="toast" role="alert"><span>{toast}</span><IconButton name="Cross2Icon" label="Dismiss message" onClick={()=>setToast('')}/></div>}
    {searchOpen&&<Modal title="Search workspace" returnFocus={searchReturnFocus.current} onClose={()=>setSearchOpen(false)}><label className="search-input global-search"><Icon name="MagnifyingGlassIcon"/><input autoFocus role="combobox" aria-expanded="true" aria-controls="workspace-results" aria-activedescendant={results.length?'workspace-result-'+selected:undefined} aria-label="Search across titles, writing and labels" value={search} onChange={e=>{setSearch(e.target.value);setSearchSelected(0)}} onCompositionStart={()=>searchComposition.current=true} onCompositionEnd={()=>searchComposition.current=false} placeholder="Titles, writing and labels…" onKeyDown={e=>{
      const action=searchKeyAction(e.key,selected,results.length,e.nativeEvent.isComposing||searchComposition.current||e.keyCode===229);
      if(Object.keys(action).length){e.preventDefault();e.stopPropagation()}
      if(action.selected!==undefined)setSearchSelected(action.selected);
      if(action.open!==undefined)chooseResult(action.open);
      if(action.close)setSearchOpen(false);
    }}/></label><div id="workspace-results" className="search-results" role="listbox" aria-label="Matching pages">{results.map((p,index)=><button role="option" aria-selected={index===selected} id={'workspace-result-'+index} className={index===selected?'selected':''} key={p.id} onClick={()=>chooseResult(index)}><Icon name="FileTextIcon"/><span className="search-result-copy"><strong>{p.title||'Untitled'}</strong><small className="muted">{searchSnippet(p,search,snapshot.labels)}</small></span><small className="muted search-result-labels">{p.labels.map(id=>snapshot.labels.find(l=>l.id===id)?.name??id).join(', ')}</small></button>)}{!results.length&&<p className="muted">No matching pages.</p>}</div><small className="muted">↑↓ select · Return opens · Esc closes · ⌘N creates a page</small></Modal>}
  </div></AppContext.Provider>;
}
