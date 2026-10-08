import type {MenuItemConstructorOptions} from 'electron';
import type {AppEvent,PlannerUICommand} from '../shared/types';

/** Menus deliver intent to the renderer, where navigation and writing guards live. */
export class NativeCommandQueue {
  private ready=false;
  private pending:PlannerUICommand[]=[];
  constructor(private showAndFocus:()=>Promise<void>,private emit:(event:AppEvent)=>void){}
  async dispatch(command:PlannerUICommand){this.pending.push(command);await this.showAndFocus();this.drain()}
  setReady(ready:boolean){this.ready=ready;this.drain()}
  private drain(){if(!this.ready)return;for(const command of this.pending.splice(0))this.emit({type:'ui-command',data:{command}})}
}

export function createPlannerMenus(dispatch:(command:PlannerUICommand)=>Promise<void>,open:()=>void,quit:()=>void):{application:MenuItemConstructorOptions[];tray:MenuItemConstructorOptions[]}{
  const command=(label:string,value:PlannerUICommand,accelerator?:string):MenuItemConstructorOptions=>({label,accelerator,click:()=>dispatch(value)});
  return {
    application:[
      {label:'Planner',submenu:[{role:'about'},{label:'Open Planner',click:open},command('Settings…','settings','CommandOrControl+,'),{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
      {label:'File',submenu:[command('New Page','new-page','CommandOrControl+N')]},
      {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'},{type:'separator'},command('Search','search','CommandOrControl+K')]},
      // Navigation has no editor-conflicting shortcut (for example Cmd+[ or Cmd+arrow).
      {label:'View',submenu:[command('Today','today'),command('Back','back'),command('Forward','forward'),{type:'separator'},{role:'toggleDevTools'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]},
      {label:'Window',submenu:[{role:'minimize'},{role:'zoom'},{type:'separator'},{role:'front'}]}
    ],
    tray:[{label:'Open Planner',click:open},command('New Page','new-page'),{type:'separator'},{label:'Quit Planner',click:quit}]
  };
}
