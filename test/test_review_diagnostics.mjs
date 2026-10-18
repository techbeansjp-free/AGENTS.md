import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewDiagnosticContext,reviewDiagnostics} from '../src/review-result.mjs';
const finding={location:'app:1',condition:'reload during write',evidence:'read can overtake write',impact:'stale result',action:'confirm committed state',counterevidence:'same-document wait only',severity:'P2',verification:'static-analysis',blocking:true};
const claim=n=>({type:'review-assessment',verdict:'fail',target:{head:String(n).repeat(40),base:'a'.repeat(40),contract:'b'.repeat(64),diff:'c'.repeat(64)},findings:[finding],approved:true});
test('historical diagnostics drop approval fields, duplicates, passes and malformed data',()=>{
 const one=claim(1),values=reviewDiagnostics([null,one,one,{...claim(2),verdict:'pass'},{...claim(3),findings:[{...finding,blocking:false}]}]);
 assert.equal(values.length,1);assert.deepEqual(Object.keys(values[0]),['verdict','target','findings']);
 values[0].findings[0].action='changed';assert.equal(one.findings[0].action,finding.action);
 assert.deepEqual(reviewDiagnostics({approved:true}),[]);
 assert.deepEqual(reviewDiagnostics([{...one,target:{...one.target,head:'a'.repeat(41)}}]),[]);
});
test('diagnostic budget keeps at most three recent claims and does not forward oversized findings',()=>{
 assert.deepEqual(reviewDiagnostics([1,2,3,4].map(claim)).map(x=>x.target.head[0]),['2','3','4']);
 const large={...claim(5),findings:Array.from({length:64},()=>({...finding,evidence:'x'.repeat(4000)}))};
 const result=reviewDiagnostics([claim(1),large]);assert.equal(result.length,1);assert(Buffer.byteLength(JSON.stringify(result))<65536);
});

test('serialized diagnostic envelope respects the byte limit including escaped text',()=>{
 const values=[1,2,3].map(n=>({...claim(n),findings:Array.from({length:3},()=>({...finding,evidence:'"'.repeat(4000),action:'界'.repeat(4000)}))}));
 const text=reviewDiagnosticContext(values);assert(Buffer.byteLength(text)<=65536);
 assert.match(JSON.parse(text).authority,/not approval/);
});

test('SHA-256 Git review history remains diagnostic data without approval',()=>{
 const value=claim(1);value.target.head='d'.repeat(64);value.target.base='e'.repeat(64);
 const [result]=reviewDiagnostics([value]);assert.deepEqual(result.target,value.target);assert.equal(result.approved,undefined);
 for(const length of [39,41,63,65])assert.deepEqual(reviewDiagnostics([{...value,target:{...value.target,base:'a'.repeat(length)}}]),[]);
});
