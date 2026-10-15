import {describe,expect,it} from 'vitest';
import {createNormalizer,normalize} from '../../packages/core/src/scales';
import type {Domain,ScaleKind} from '../../packages/core/src/types';

describe('prepared query normalization',()=>{
  const cases:Array<{name:string;kind:ScaleKind;domain:Domain}>=[
    {name:'ordinary linear',kind:'linear',domain:[-3,7]},
    {name:'large nearby linear values',kind:'linear',domain:[1e15,1e15+1]},
    {name:'adjacent linear values',kind:'linear',domain:[1,1+Number.EPSILON]},
    {name:'subnormal linear span',kind:'linear',domain:[Number.MIN_VALUE,Number.MIN_VALUE*2]},
    {name:'overflowing linear span',kind:'linear',domain:[-Number.MAX_VALUE,Number.MAX_VALUE]},
    {name:'large positive linear values',kind:'linear',domain:[1e308,Number.MAX_VALUE]},
    {name:'large negative linear values',kind:'linear',domain:[-Number.MAX_VALUE,-1e308]},
    {name:'full calendar interval',kind:'time',domain:[-8.64e15,8.64e15]},
    {name:'upper calendar boundary',kind:'time',domain:[8.64e15-100,8.64e15]},
    {name:'ordinary logarithmic',kind:'log',domain:[.1,100]},
    {name:'adjacent logarithmic values',kind:'log',domain:[1,1+Number.EPSILON]},
    {name:'subnormal logarithmic values',kind:'log',domain:[Number.MIN_VALUE,Number.MIN_VALUE*2]},
    {name:'overflowing logarithmic ratio',kind:'log',domain:[Number.MIN_VALUE,Number.MAX_VALUE]},
    {name:'underflowing out-of-domain logarithmic input',kind:'log',domain:[1e300,1e308]},
  ];
  for(const {name,kind,domain}of cases)it(`matches normalize exactly for ${name}`,()=>{
    const prepared=createNormalizer(domain,kind);
    const values=[NaN,-Infinity,Infinity,-Number.MAX_VALUE,Number.MAX_VALUE,-1,-Number.MIN_VALUE,-0,0,Number.MIN_VALUE,Number.MIN_VALUE*2,.1,1,1+Number.EPSILON,1e15,1e15+.125,1e300,1e308,
      -8.64e15-1,-8.64e15,-8.64e15+1,8.64e15-1,8.64e15,8.64e15+1,domain[0],domain[1],domain[0]/2+domain[1]/2];
    for(let index=0;index<=20;index++)values.push(domain[0]*(1-index/20)+domain[1]*(index/20));
    // Object.is semantics deliberately check signed zero, NaN and infinities too.
    for(const value of values)expect(prepared(value),`value=${value}`).toBe(normalize(value,domain,kind));
  });
});
