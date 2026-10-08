/** Freeze admission only after saving, then finish every already-admitted request. */
export class RequestDrain {
  private paused=false;
  private pending=new Set<Promise<unknown>>();
  run<T>(action:()=>Promise<T>):Promise<T>{
    if(this.paused)return Promise.reject(new Error('Planner is finishing Quit. Try again if it resumes.'));
    let job:Promise<T>;try{job=Promise.resolve(action())}catch(error){job=Promise.reject(error)}
    this.pending.add(job);void job.then(()=>this.pending.delete(job),()=>this.pending.delete(job));return job;
  }
  async pauseAndDrain(){
    this.paused=true;
    const results=await Promise.allSettled([...this.pending]);
    const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
  }
  resume(){this.paused=false}
}
