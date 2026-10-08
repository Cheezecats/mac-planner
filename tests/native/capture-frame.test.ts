import {it,expect,vi} from 'vitest';
import {Script} from 'node:vm';
import {waitForCaptureFrame} from '../../src/electron/capture-frame';

it('an occluded renderer with paused animation frames fails capture with a native deadline',async()=>{
  vi.useFakeTimers();try{
    const contents={executeJavaScript:(script:string)=>{new Script(script);return new Promise(()=>{})}};
    const capture=waitForCaptureFrame(contents,'page-narrow.png');
    const observed=expect(capture).rejects.toThrow('page-narrow.png did not paint within 5 seconds');
    await vi.advanceTimersByTimeAsync(5000);await observed;expect(vi.getTimerCount()).toBe(0);
  }finally{vi.useRealTimers()}
});
it('a painted frame clears its deadline without inventing a fallback screenshot',async()=>{
  vi.useFakeTimers();try{
    await waitForCaptureFrame({executeJavaScript:async(script:string)=>{new Script(script)}},'calendar.png');
    expect(vi.getTimerCount()).toBe(0);
  }finally{vi.useRealTimers()}
});
