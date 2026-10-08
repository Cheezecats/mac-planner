import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '../../src/core/domain';
import { sealArchive, openArchive, validateArchiveAssets } from '../../src/electron/archive';
import { sanitizeWidgetSource, isAllowedWidgetURL, widgetBridgeMessage } from '../../src/electron/widget-policy';

describe('portable backup encryption',()=>{
  it('roundtrips structured data and bytes without exposing content, tokens, or requiring original Keychain',()=>{
    const snapshot=createEmptyWorkspace();
    snapshot.settings.backupPath='/private/sensitive/location';
    const bytes=Buffer.from('private attachment');
    const sealed=sealArchive({snapshot,assets:{asset01:bytes.toString('base64')}},'eight secret words');
    expect(sealed.toString()).not.toContain('private attachment');
    const restored=openArchive(sealed,'eight secret words');
    expect(Buffer.from(restored.assets.asset01,'base64')).toEqual(bytes);
    expect(restored.snapshot.schemaVersion).toBe(1);
  });
  it('rejects wrong passwords and tampering without returning partial data',()=>{
    const sealed=sealArchive({snapshot:createEmptyWorkspace(),assets:{}},'correct password');
    expect(()=>openArchive(sealed,'wrong password')).toThrow();
    sealed[sealed.length-1]^=1;
    expect(()=>openArchive(sealed,'correct password')).toThrow();
  });
  it('rejects unsafe archive asset identifiers and missing copies',()=>{
    expect(()=>validateArchiveAssets({'../outside':'YQ=='},[])).toThrow();
    expect(()=>validateArchiveAssets({},[{id:'asset01',pageId:'p',name:'f',kind:'copy',mime:'text/plain',size:1,storageName:'x'}])).toThrow();
  });
});
describe('widget containment policy',()=>{
  it('injects a restrictive content policy and strips remote resource entry points',()=>{
    const html=sanitizeWidgetSource('<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body><script src="https://bad.test/x.js"></script><script>document.body.textContent="Hello"</script></body></html>');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("frame-src 'none'");
    expect(html).not.toContain('default-src *');
  });
  it('denies navigation except the initial blank document',()=>{
    expect(isAllowedWidgetURL('https://example.com')).toBe(false);
    expect(isAllowedWidgetURL('file:///etc/passwd')).toBe(false);
    expect(isAllowedWidgetURL('about:blank')).toBe(true);
  });
  it('only accepts bounded own-state messages from the matching widget',()=>{
    expect(widgetBridgeMessage({type:'save-state',id:'a',state:{mass:2}},'a')).toEqual({mass:2});
    expect(()=>widgetBridgeMessage({type:'save-state',id:'b',state:{}},'a')).toThrow();
    expect(()=>widgetBridgeMessage({type:'shell',id:'a',state:{}},'a')).toThrow();
    expect(()=>widgetBridgeMessage({type:'save-state',id:'a',state:{data:'x'.repeat(1100000)}},'a')).toThrow();
  });
});
