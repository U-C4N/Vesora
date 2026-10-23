import {expect,it} from 'vitest';
import {Figure,Layer} from '../../packages/core/src/figure';

it('keeps an imported observation across empty/equivalent semantic patches regardless of JSON key order',()=>{
  const source=new Figure(),line=source.plot([0],[273]),snapshot=source.snapshot();snapshot.figure.protocolVersion=8;
  snapshot.figure.semantics={schemaVersion:1,sources:{[line.spec.data.y]:{unit:'K',quantity:'temperature'}}};
  snapshot.figure.observation={schemaVersion:1,source:'accepted',capturedAt:'2026-10-23T10:00:00.000Z',sourceVersions:snapshot.sources.map(({id,version})=>({id,version})),streams:[],representation:{status:'not-evaluated'}};
  const copy=new Figure();copy.applySnapshot(snapshot,new Map([...source.registry.entries()].map(([id,entry])=>[id,entry.values.slice().buffer as ArrayBuffer])));
  const imported=new Layer(copy,line.id),revision=copy.acceptedRevision;
  imported.setSemantics({});imported.setSemantics({y:{quantity:'temperature',unit:'K'}});
  expect(copy.snapshot()).toEqual(snapshot);expect(copy.acceptedRevision).toBe(revision);
  imported.setSemantics({y:{unit:'°C'}});expect(copy.getObservation()).toBeUndefined();copy.close();source.close();
});
