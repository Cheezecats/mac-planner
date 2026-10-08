import type {WebContents} from 'electron';

/** A native deadline still runs when an occluded renderer pauses animation frames. */
export async function waitForCaptureFrame(contents:Pick<WebContents,'executeJavaScript'>,name:string){
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error(`${name} did not paint within 5 seconds; the window may be hidden or occluded.`)),5000)});
  try{await Promise.race([contents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'),deadline])}
  finally{clearTimeout(timer)}
}
