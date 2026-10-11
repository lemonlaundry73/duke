// Encryption for stored API credentials (AES-256-GCM). The key comes from DUKE_SECRET_KEY (64 hex chars)
// or is generated once into DATA_DIR/secret.key with owner-only permissions. Decrypted values are only
// ever used server-side to call providers; they are never sent to the browser, prompts or project files.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

let KEY=null;
function key(){
  if(KEY)return KEY;
  if(process.env.DUKE_SECRET_KEY){KEY=createHash('sha256').update(process.env.DUKE_SECRET_KEY).digest();return KEY;}
  const file=path.join(DATA_DIR,'secret.key');
  try{KEY=Buffer.from(fs.readFileSync(file,'utf8').trim(),'hex');if(KEY.length===32)return KEY;}catch{}
  KEY=randomBytes(32);fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(file,KEY.toString('hex'),{mode:0o600});
  return KEY;
}
export function seal(plain){
  const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key(),iv);
  const enc=Buffer.concat([c.update(String(plain),'utf8'),c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
export function open(sealed){
  const [v,iv,tag,enc]=String(sealed||'').split('.');if(v!=='v1')throw new Error('Unknown secret format');
  const d=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(tag,'base64'));
  return Buffer.concat([d.update(Buffer.from(enc,'base64')),d.final()]).toString('utf8');
}
export const hint=s=>s?`${String(s).slice(0,4)}…${String(s).slice(-4)}`:'';
