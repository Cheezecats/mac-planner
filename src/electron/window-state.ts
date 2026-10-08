import type {IntegrationVault} from '../integrations/types';
export interface WindowBounds {x:number;y:number;width:number;height:number}
export interface WindowState {bounds:WindowBounds;maximized:boolean}
const key='native:window-state';
function valid(bounds:unknown):bounds is WindowBounds{
  if(!bounds||typeof bounds!=='object')return false;
  const b=bounds as WindowBounds;
  return [b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.width>0&&b.height>0;
}
export function clampWindowBounds(saved:unknown,workAreas:WindowBounds[]):WindowBounds{
  const areas=workAreas.filter(valid);if(!areas.length)throw new Error('No available display work area');
  const b=valid(saved)?saved:null;
  const overlap=(area:WindowBounds)=>b?Math.max(0,Math.min(b.x+b.width,area.x+area.width)-Math.max(b.x,area.x))*Math.max(0,Math.min(b.y+b.height,area.y+area.height)-Math.max(b.y,area.y)):0;
  const target=areas.reduce((best,area)=>overlap(area)>overlap(best)?area:best,areas[0]);
  const width=Math.round(Math.min(target.width,Math.max(680,b?.width??1260))),height=Math.round(Math.min(target.height,Math.max(480,b?.height??860)));
  const visible=b&&overlap(target)>0;
  const x=visible?b.x:target.x+(target.width-width)/2,y=visible?b.y:target.y+(target.height-height)/2;
  return {x:Math.round(Math.min(Math.max(x,target.x),target.x+target.width-width)),y:Math.round(Math.min(Math.max(y,target.y),target.y+target.height-height)),width,height};
}
export class WindowStateStore {
  constructor(private vault:Pick<IntegrationVault,'get'|'set'>){}
  async load(workAreas:WindowBounds[]):Promise<WindowState>{
    const state=await this.vault.get<WindowState>(key);
    return {bounds:clampWindowBounds(state?.bounds,workAreas),maximized:state?.maximized===true};
  }
  async save(state:WindowState){if(!valid(state.bounds))throw new Error('Invalid window bounds');await this.vault.set(key,{bounds:state.bounds,maximized:state.maximized===true})}
}
