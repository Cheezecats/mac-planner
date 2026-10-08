import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadPublicConfiguration} from '../../src/electron/public-config';
describe('packaged public registrations',()=>{
  it('uses packaged IDs without a launch environment and allows a development override',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'planner-config-'));const path=join(directory,'public-config.json');
    try{await writeFile(path,JSON.stringify({googleClientId:'google-public',microsoftClientId:'microsoft-public',secret:'never exposed'}));
      expect(await loadPublicConfiguration(path,{})).toEqual({googleClientId:'google-public',microsoftClientId:'microsoft-public'});
      expect(await loadPublicConfiguration(path,{PLANNER_GOOGLE_CLIENT_ID:'development'})).toEqual({googleClientId:'development',microsoftClientId:'microsoft-public'});
      await writeFile(path,'invalid');expect(await loadPublicConfiguration(path,{})).toEqual({});
      expect(await loadPublicConfiguration(join(directory,'missing'),{})).toEqual({});
    }finally{await rm(directory,{recursive:true,force:true})}
  });
});
