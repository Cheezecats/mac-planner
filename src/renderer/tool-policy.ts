/** Browser preview uses a restrictive CSP in addition to an opaque iframe sandbox. */
export function safePreviewToolSource(source:string):string {
  if(new TextEncoder().encode(source).byteLength>2_000_000)throw new Error('Tool source is too large');
  const clean=source.replace(/<meta\b[^>]*>/gi,tag=>/http-equiv\s*=\s*["']?\s*(?:content-security-policy|refresh)/i.test(tag)?'':tag).replace(/<base\b[^>]*>/gi,'');
  const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta charset="utf-8"></head><body>${clean}</body></html>`;
}
