const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function sanitizeWidgetSource(source:string):string {
  if(typeof source!=='string'||Buffer.byteLength(source)>2_000_000)throw new Error('Tool source is too large');
  const body=source.replace(/<meta\b[^>]*>/gi,tag=>/http-equiv\s*=\s*["']?\s*(?:content-security-policy|refresh)/i.test(tag)?'':tag).replace(/<base\b[^>]*>/gi,'');
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta charset="utf-8"><meta name="color-scheme" content="light"><style>:root{color-scheme:light}body{background:#fff;color:#20252d;font:13px -apple-system,BlinkMacSystemFont,sans-serif}</style></head><body>${body}</body></html>`;
}
export function isAllowedWidgetURL(url:string):boolean{return url==='about:blank'}
export function widgetBridgeMessage(message:unknown,id:string):Record<string,unknown>{
  const m=message as Record<string,unknown>;
  if(!m||m.type!=='save-state'||m.id!==id||!m.state||typeof m.state!=='object'||Array.isArray(m.state))throw new Error('Invalid tool state message');
  if(Buffer.byteLength(JSON.stringify(m.state))>1_000_000)throw new Error('Tool state is too large');
  return JSON.parse(JSON.stringify(m.state));
}
