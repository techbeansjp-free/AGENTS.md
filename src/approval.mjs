/** Owner-authenticated design approvals. The host pins keys; the candidate never does. */
import {createPublicKey, verify, createHash, timingSafeEqual} from 'node:crypto';

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw Error('Invalid approval structure');
}
function text(value) {
  if (typeof value !== 'string' || !value.length || value.length > 8192) throw Error('Invalid approval string');
}
export function approvalBytes(payload) {
  exact(payload, ['schema','purpose','authority','binding','issuedAt','expiresAt']);
  if (payload.schema !== 'asc-owner-approval/v1' || payload.purpose !== 'design') throw Error('Wrong approval purpose');
  text(payload.authority);
  exact(payload.binding, ['contract','base','scope']);
  if (!/^[a-f0-9]{64}$/.test(payload.binding.contract) ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(payload.binding.base) ||
      !/^[a-f0-9]{64}$/.test(payload.binding.scope)) throw Error('Invalid approval binding');
  for (const time of [payload.issuedAt,payload.expiresAt]) {
    if (!Number.isSafeInteger(time) || time < 0) throw Error('Invalid approval time');
  }
  if (payload.expiresAt <= payload.issuedAt) throw Error('Invalid approval interval');
  // Explicit ordered fields, not caller-controlled JSON key order or arbitrary object coercion.
  return Buffer.from(JSON.stringify([payload.schema,payload.purpose,payload.authority,
    payload.binding.contract,payload.binding.base,payload.binding.scope,payload.issuedAt,payload.expiresAt]));
}
export function keyFingerprint(publicKey) {
  return createHash('sha256').update(createPublicKey(publicKey).export({type:'spki',format:'der'})).digest('hex');
}
export function verifyApproval(envelope, binding, trustedKeys, now = Date.now()) {
  exact(envelope, ['payload','signature']);
  const bytes = approvalBytes(envelope.payload);
  exact(binding, ['contract','base','scope']);
  if (!Number.isSafeInteger(now)) throw Error('Invalid host clock');
  const p=envelope.payload;
  if (p.issuedAt > now || p.expiresAt <= now || p.expiresAt-p.issuedAt > 86400000) throw Error('Approval expired or not yet valid');
  for (const k of ['contract','base','scope']) if (p.binding[k] !== binding[k]) throw Error('Stale approval binding');
  if (!Array.isArray(trustedKeys)) throw Error('Host trust policy missing');
  const matches=trustedKeys.filter(k => k.authority === p.authority && k.purpose === 'design');
  if (matches.length !== 1) throw Error('Untrusted or ambiguous authority');
  const owner=matches[0];
  exact(owner, ['authority','purpose','publicKey','fingerprint']);
  text(owner.publicKey);
  if (!/^[a-f0-9]{64}$/.test(owner.fingerprint)) throw Error('Invalid pinned fingerprint');
  if (!timingSafeEqual(Buffer.from(keyFingerprint(owner.publicKey),'hex'),Buffer.from(owner.fingerprint,'hex'))) throw Error('Wrong owner key');
  const key=createPublicKey(owner.publicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw Error('Only Ed25519 owner keys supported');
  if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw Error('Invalid signature encoding');
  const signature=Buffer.from(envelope.signature,'base64');
  if (signature.toString('base64') !== envelope.signature || !verify(null,bytes,key,signature)) throw Error('Invalid owner signature');
  return {approved:true,authority:p.authority,binding:{...binding},expiresAt:p.expiresAt,
    approvalDigest:createHash('sha256').update(bytes).update(signature).digest('hex')};
}
