import {readFile} from 'node:fs/promises';
export interface PublicConfiguration {googleClientId?:string;microsoftClientId?:string}
function publicId(value:unknown){return typeof value==='string'&&value.trim().length>0&&value.length<=512&&!/[\r\n\0]/.test(value)?value.trim():undefined}
/** No secrets are read from the package. Missing registration keeps the offline planner usable. */
export async function loadPublicConfiguration(path:string,environment:NodeJS.ProcessEnv=process.env):Promise<PublicConfiguration>{
  let packaged:Record<string,unknown>={};
  try{const value=JSON.parse(await readFile(path,'utf8'));if(value&&typeof value==='object'&&!Array.isArray(value))packaged=value}catch{}
  return {googleClientId:publicId(environment.PLANNER_GOOGLE_CLIENT_ID)??publicId(packaged.googleClientId),microsoftClientId:publicId(environment.PLANNER_MICROSOFT_CLIENT_ID)??publicId(packaged.microsoftClientId)};
}
