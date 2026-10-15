import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {approvalBytes,keyFingerprint,verifyApproval} from './src/approval.mjs';
const keys=generateKeyPairSync('ed25519');
const publicKey=keys.publicKey.export({type:'spki',format:'pem'});
const policy=[{authority:'fixture-owner',purpose:'design',publicKey,fingerprint:keyFingerprint(publicKey)}];
const binding={contract:'a'.repeat(64),base:'b'.repeat(40),scope:'c'.repeat(64)};
const payload={schema:'asc-owner-approval/v1',purpose:'design',authority:'fixture-owner',binding,issuedAt:1000,expiresAt:2000};
const seal=p=>({payload:p,signature:sign(null,approvalBytes(p),keys.privateKey).toString('base64')});
const valid=seal(payload);
test('owner signature accepts only the exact live binding',()=>{
  assert.equal(verifyApproval(valid,binding,policy,1500).approved,true);
  for (const field of Object.keys(binding)) assert.throws(()=>verifyApproval(valid,{...binding,[field]:'d'.repeat(binding[field].length)},policy,1500),/Stale/);
});
test('tampered, unknown, replaced and ambiguous signer fail closed',()=>{
  assert.throws(()=>verifyApproval({...valid,signature:Buffer.alloc(64).toString('base64')},binding,policy,1500),/signature/);
  assert.throws(()=>verifyApproval(valid,binding,[],1500),/Untrusted/);
  assert.throws(()=>verifyApproval(valid,binding,[...policy,...policy],1500),/ambiguous/);
  assert.throws(()=>verifyApproval(valid,binding,[{...policy[0],fingerprint:'0'.repeat(64)}],1500),/Wrong owner/);
  const other=generateKeyPairSync('ed25519');
  assert.throws(()=>verifyApproval({...valid,signature:sign(null,approvalBytes(payload),other.privateKey).toString('base64')},binding,policy,1500),/signature/);
});
test('clock boundaries and excessive lifetime are refused',()=>{
  for (const now of [999,2000,2001,NaN]) assert.throws(()=>verifyApproval(valid,binding,policy,now));
  assert.throws(()=>verifyApproval(seal({...payload,expiresAt:90000000}),binding,policy,1500),/expired/);
});
test('purpose confusion and unknown fields are refused, not silently ignored',()=>{
  assert.throws(()=>seal({...payload,purpose:'delivery'}),/purpose/);
  assert.throws(()=>seal({...payload,approved:true}),/structure/);
  assert.throws(()=>verifyApproval({...valid,publicKey},binding,policy,1500),/structure/);
  assert.throws(()=>verifyApproval(valid,{...binding,head:'e'.repeat(40)},policy,1500),/structure/);
});
test('signature encoding and binding shape are strict',()=>{
  assert.throws(()=>verifyApproval({...valid,signature:valid.signature+'\n'},binding,policy,1500));
  assert.throws(()=>seal({...payload,binding:{...binding,scope:'short'}}));
});
