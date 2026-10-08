import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';

it('native smoke browser scripts remain valid after TypeScript string escaping',async()=>{
  const source=await readFile('src/electron/smoke.ts','utf8');
  // Evaluate the actual source literals first, then compile the browser programs.
  // This catches quote loss between the TypeScript and executeJavaScript layers.
  const literals=source.matchAll(/\b(?:executeJavaScript|waitFor)\(('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\$])*`)/g);
  const expressions=Array.from(literals,match=>new Script(`(${match[1]})`).runInNewContext() as string);
  expect(expressions.length).toBeGreaterThan(20);
  for(const expression of expressions)expect(()=>new Script(expression),expression).not.toThrow();
});
