import { describe,it,expect } from 'vitest';
import { createEmptyWorkspace, validateWorkspace } from '../../src/core/domain';
import { PlannerService } from '../../src/core/service';

describe('short answer assessment persistence',()=>{
 it('records the original answer and a separate validated self-assessment',()=>{
  let state=createEmptyWorkspace();const service=new PlannerService({getSnapshot:()=>state,replaceSnapshot:s=>state=s});
  const p:any=service.execute('page.create',{title:'Quiz'});
  const study:any={id:'study',pageId:p.id,kind:'quiz',title:'Test',revision:1,cards:[],questions:[{id:'question',type:'short-answer',prompt:'Why?',answer:'Because'}],attempts:[{id:'attempt',at:new Date().toISOString(),answers:{question:'My explanation'},selfAssessment:{question:'got-it'}}]};
  const saved:any=service.execute('study.save',{record:study});
  expect(saved.attempts[0].answers.question).toBe('My explanation');
  expect(saved.attempts[0].selfAssessment.question).toBe('got-it');
  const invalid=structuredClone(state);(invalid.studies[0].attempts[0] as any).selfAssessment={missing:'got-it'};
  expect(()=>validateWorkspace(invalid)).toThrow('self-assessment');
 });
});
