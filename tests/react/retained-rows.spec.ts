import {describe,expect,it} from 'vitest';
import {RetainedRows} from '../../packages/react/src/retained-rows';
import type {StreamState} from '../../packages/core/src/types';

const stream=(end:number,retained=3,id='one'):StreamState=>({streamId:id,maxPoints:3,nextSequence:end,retained,evicted:end-retained,revision:end});
const rows=(first:number,end:number)=>Array.from({length:end-first},(_,i)=>({id:first+i}));
describe('application rows follow displayed stream windows',()=>{
  it('keeps an evicted displayed sample while accepted data advances',()=>{
    const ledger=new RetainedRows<{id:number}>(),initial=rows(0,3);
    ledger.replace(initial,{a:stream(3)});ledger.pin('displayed',{a:stream(3)});
    ledger.append(rows(3,6),stream(3),{a:stream(6)});
    expect(ledger.row('one',0)).toBe(initial[0]);expect(ledger.liveRows()).toEqual(rows(3,6));
    ledger.pin('displayed',{a:stream(6)});
    expect(ledger.row('one',0)).toBeUndefined();expect(ledger.retainedReferences).toBe(3);
  });
  it('pins an intermediate rendering frame until it becomes displayed',()=>{
    const ledger=new RetainedRows<{id:number}>();ledger.replace(rows(0,3),{a:stream(3)});ledger.pin('displayed',{a:stream(3)});
    ledger.append(rows(3,6),stream(3),{a:stream(6)});ledger.pin('pending',{a:stream(6)});
    ledger.append(rows(6,9),stream(6),{a:stream(9)});
    expect(ledger.row('one',4)).toEqual({id:4});expect(ledger.retainedReferences).toBe(9);
    ledger.pin('displayed',{a:stream(6)});expect(ledger.row('one',4)).toEqual({id:4});expect(ledger.row('one',1)).toBeUndefined();
  });
  it('bounds retained references across a long frozen interval and oversized batches',()=>{
    const ledger=new RetainedRows<{id:number}>();ledger.replace(rows(0,3),{a:stream(3),b:stream(3,3,'two')});ledger.pin('displayed',{a:stream(3),b:stream(3,3,'two')});
    for(let end=6;end<=300;end+=3)ledger.append(rows(end-3,end),stream(end-3),{a:stream(end),b:stream(end,3,'two')});
    expect(ledger.retainedReferences).toBe(6);expect(ledger.row('two',1)).toEqual({id:1});
    ledger.append(rows(300,1300),stream(300),{a:stream(1300),b:stream(1300,3,'two')});
    expect(ledger.retainedReferences).toBe(6);expect(ledger.liveRows()).toEqual(rows(1297,1300));
  });
  it('keeps old frame identity across a stream reset and then releases it',()=>{
    const ledger=new RetainedRows<{id:number}>();ledger.replace(rows(0,3),{a:stream(3)});ledger.pin('displayed',{a:stream(3)});
    ledger.replace([{id:99}],{a:stream(1,1,'new')});
    expect(ledger.row('one',1)).toEqual({id:1});expect(ledger.row('new',0)).toEqual({id:99});
    ledger.pin('displayed',{a:stream(1,1,'new')});expect(ledger.row('one',1)).toBeUndefined();
    ledger.clear();expect(ledger.retainedReferences).toBe(0);
  });
});
