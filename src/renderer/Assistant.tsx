import { useEffect, useRef, useState } from 'react';
import type { Page } from '../shared/types';
import { BusyButton, IconButton, useApp } from './ui';
import { sendScopedAssistant } from './logic';
interface Message {role:string;text:string}
interface Props {page?:Page;onClose:()=>void}

export function AssistantPanel(props:Props) {
  const {snapshot}=useApp();
  const account=snapshot.connections.find(connection=>connection.provider==='openai'&&connection.status==='connected');
  return <ScopedAssistantPanel key={`${props.page?.id??'none'}:${account?.id??'offline'}`} {...props} connected={Boolean(account)}/>;
}

function ScopedAssistantPanel({page,onClose,connected}:Props&{connected:boolean}) {
  const {snapshot,api,request,flushPage}=useApp();
  const [models,setModels]=useState<{slug:string;display_name:string}[]>([]),[model,setModel]=useState('');
  const [text,setText]=useState(''),[assets,setAssets]=useState<string[]>([]),[messages,setMessages]=useState<Message[]>([]);
  const [stream,setStream]=useState(''),[running,setRunning]=useState(false),[error,setError]=useState(''),[last,setLast]=useState('');
  const [proposals,setProposals]=useState<{pageId:string;date:any;reason:string}[]>([]);
  const live=useRef(true),active=useRef(false),historyVersion=useRef(0),streamText=useRef('');
  useEffect(()=>{
    live.current=true;
    const version=historyVersion.current;
    if(page&&connected){
      void api.request<any>('assistant.history',{pageId:page.id}).then(result=>{
        if(!live.current||version!==historyVersion.current)return;
        const list=Array.isArray(result)?result:result?.messages??[];
        setMessages(list.map((message:any)=>({role:message.role??'assistant',text:typeof message.content==='string'?message.content:message.text??JSON.stringify(message.content??'')})));
      }).catch(error=>{if(live.current&&version===historyVersion.current)setError(String(error))});
      void api.request<any[]>('assistant.models').then(items=>{if(live.current){setModels(items);setModel(current=>current||items[0]?.slug||'')}}).catch(error=>{if(live.current)setError(String(error))});
    }
    return ()=>{
      live.current=false;historyVersion.current++;
      if(page&&active.current)void api.request('assistant.cancel',{pageId:page.id}).catch(()=>{});
      active.current=false;
    };
  },[api,page?.id,connected]);
  useEffect(()=>api.subscribe(event=>{
    if(!live.current||!active.current||event.pageId!==page?.id)return;
    if(event.type==='assistant-delta'){streamText.current+=event.text??'';setStream(streamText.current)}
    if(event.type==='assistant-done'){
      active.current=false;setRunning(false);
      const data=event.data as any;
      setProposals(Array.isArray(data?.proposals)?data.proposals.filter((proposal:any)=>proposal.pageId===page?.id):[]);
      if(streamText.current)setMessages(current=>[...current,{role:'assistant',text:streamText.current}]);
      streamText.current='';setStream('');
    }
    if(event.type==='assistant-error'){active.current=false;setRunning(false);setError(event.text??'The assistant could not finish this response. Try again.')}
  }),[api,page?.id]);
  const send=async(value:string)=>{
    if(!page)throw new Error('Open a page first');
    if(!value.trim())return;
    if(active.current)throw new Error('Finish or cancel the current response first.');
    active.current=true;historyVersion.current++;streamText.current='';setStream('');setProposals([]);setError('');setLast(value);setRunning(true);
    setMessages(current=>[...current,{role:'user',text:value}]);setText('');
    try{
      await sendScopedAssistant({flushPage,request,snapshot,page,text:value,model,assetIds:assets,isCurrent:()=>live.current&&active.current});
    }catch(error){if(live.current){active.current=false;setRunning(false);setError(error instanceof Error?error.message:String(error))}throw error}
  };
  return <aside className="assistant-panel"><header><strong>Assistant</strong><IconButton name="Cross2Icon" label="Close assistant" onClick={onClose}/></header>
    <div className="assistant-context"><span className="source-chip">{page?.title||'Open a page for context'}</span>{page&&snapshot.assets.filter(asset=>asset.pageId===page.id).map(asset=><label className="source-chip" key={asset.id}><input type="checkbox" checked={assets.includes(asset.id)} onChange={event=>setAssets(current=>event.target.checked?[...current,asset.id]:current.filter(id=>id!==asset.id))}/>{asset.name}</label>)}</div>
    {connected?<><label className="model-select">Model<select value={model} onChange={event=>setModel(event.target.value)}>{models.length?models.map(item=><option key={item.slug} value={item.slug}>{item.display_name}</option>):<option value="">Available model</option>}</select></label>
      <div className="assistant-messages">{!messages.length&&!stream&&<p className="muted">Ask about this page, turn your selected material into flashcards, or build an interactive exercise.</p>}{messages.map((message,index)=><div className={`assistant-message ${message.role}`} key={index}><small className="muted">{message.role==='user'?'You':'Assistant'}</small><p>{message.text}</p></div>)}{stream&&<div className="assistant-message"><small className="muted">Assistant</small><p>{stream}<span className="stream-cursor">▏</span></p></div>}</div>
      {proposals.map((proposal,index)=><div className="assistant-proposal" key={index}><strong>Suggested deadline</strong><p>{typeof proposal.date==='string'?proposal.date:proposal.date?.date} {proposal.reason}</p><BusyButton action={async()=>{const target=snapshot.pages.find(item=>item.id===proposal.pageId);if(!target)throw new Error('The target page is unavailable');await flushPage();const latest=await api.request<any>('workspace.get');const current=latest.pages.find((item:Page)=>item.id===target.id);if(!current)throw new Error('The target page is unavailable');await request('page.update',{id:current.id,expectedRevision:current.revision,changes:{deadline:proposal.date}});setProposals(items=>items.filter((_,itemIndex)=>itemIndex!==index))}}>Apply deadline</BusyButton><button onClick={()=>setProposals(items=>items.filter((_,itemIndex)=>itemIndex!==index))}>Dismiss</button></div>)}
      <div className="assistant-compose"><textarea aria-label="Message assistant" placeholder={page?'Ask about this page…':'Open a page first'} value={text} disabled={!page||running} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();void send(text).catch(()=>{})}}}/><div className="tool-actions">{running?<BusyButton action={async()=>{await request('assistant.cancel',{pageId:page!.id});active.current=false;setRunning(false)}}>Cancel</BusyButton>:<BusyButton action={()=>send(text)}>Send</BusyButton>}</div></div>
    </>:<div className="assistant-signin"><p>Connect your ChatGPT account to work with this page and the assets you choose.</p><BusyButton action={async()=>{setError('');try{await request('assistant.signIn')}catch(error){setError(error instanceof Error?error.message:String(error));throw error}}}>Continue with ChatGPT</BusyButton><p className="muted">The desktop app stores credentials in macOS Keychain. Local page editing works offline.</p></div>}
    {error&&<div className="assistant-error"><p className="error-message">{error}</p>{last&&connected&&<BusyButton action={()=>send(last)}>Retry last message</BusyButton>}</div>}
    <small className="assistant-note muted">{api.isDesktop?'Only this page and selected sources are sent.':'Browser preview: native authentication and assistant requests are unavailable.'}</small>
  </aside>;
}
