export function requirePlannerSurface(event:{sender:unknown;senderFrame:unknown},window:{webContents:{mainFrame:unknown}}|null){
  if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('Untrusted Planner surface');
}

/** A nonce-bound acknowledgement keeps the original trusted window alive while IPC drains. */
export class ShutdownHandshake {
  private pending:{nonce:string;resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|null=null;
  wait(nonce:string,send:()=>void):Promise<void>{
    if(this.pending)return Promise.reject(new Error('Shutdown acknowledgement is already pending'));
    return new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending=null;reject(new Error('The editor did not finish pending requests. Try quitting again after saving.'))},10_000);
      this.pending={nonce,resolve,reject,timer};
      try{send()}catch(error){clearTimeout(timer);this.pending=null;reject(error)}
    });
  }
  acknowledge(message:{nonce?:unknown;error?:unknown}){
    const pending=this.pending;
    if(!pending||message.nonce!==pending.nonce||(message.error!==undefined&&typeof message.error!=='string'))throw new Error('Invalid shutdown acknowledgement');
    this.pending=null;clearTimeout(pending.timer);
    message.error?pending.reject(new Error(String(message.error))):pending.resolve();
  }
}
