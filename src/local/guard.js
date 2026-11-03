// Duke Local: the same Duke Forger web app, served by a companion backend on the creator's own PC
// (for example a Shadow cloud PC). Turned on with DUKE_LOCAL=1 (the launcher sets it).
//
// Security model
//  * Binds to 127.0.0.1 only (DUKE_HOST may widen it on purpose; every privileged call still needs auth).
//  * Host header must name this machine on this port (stops DNS-rebinding attacks from web pages).
//  * Browser Origin must be this app for every state-changing request and WebSocket (stops other sites).
//  * Login is a one-time code the launcher reads from a file only this Windows user can read, swapped
//    for an HttpOnly SameSite=Strict session. Privileged /api/local/* calls also need a CSRF header.
//  * Outbound network: model inference never leaves the PC. Requests to non-loopback hosts are blocked
//    and logged unless the host is on DUKE_LOCAL_ALLOW_HOSTS.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { DATA_DIR } from '../paths.js';
import { HttpError } from '../http.js';

export const LOCAL=process.env.DUKE_LOCAL==='1';
export const LOCAL_PORT=Number(process.env.PORT||4310);
export const LOCAL_HOST=process.env.DUKE_HOST||'127.0.0.1';
export const OWNER_EMAIL='owner@duke.local';
const SECRET_FILE=path.join(DATA_DIR,'local','secret.json');
const CODE_FILE=path.join(DATA_DIR,'local','login-code.txt');
export const LOG_DIR=path.join(DATA_DIR,'local','logs');

const isLoopback=h=>/^(127\.\d+\.\d+\.\d+|localhost|\[?::1\]?)$/i.test(String(h||''));
export const hostOnly=h=>String(h||'').replace(/:\d+$/,'').replace(/^\[|\]$/g,'');
const allowedHosts=()=>new Set([`127.0.0.1:${LOCAL_PORT}`,`localhost:${LOCAL_PORT}`,`[::1]:${LOCAL_PORT}`,...String(process.env.DUKE_ALLOWED_HOSTS||'').split(',').map(s=>s.trim()).filter(Boolean)]);
export const allowedOrigins=()=>new Set([...allowedHosts()].map(h=>`http://${h}`));

// ---------------------------------------------------------------- secret and one-time login codes
let secret=null;const codes=new Map(); // code -> expiry
function ensureSecret(){
  if(secret)return secret;
  fs.mkdirSync(path.dirname(SECRET_FILE),{recursive:true,mode:0o700});
  try{secret=JSON.parse(fs.readFileSync(SECRET_FILE,'utf8')).secret;}catch{}
  if(!secret){secret=randomBytes(32).toString('base64url');fs.writeFileSync(SECRET_FILE,JSON.stringify({secret,createdAt:new Date().toISOString()}),{mode:0o600});}
  return secret;
}
export function newLoginCode(){
  const code=randomBytes(24).toString('base64url');codes.set(code,Date.now()+10*60e3);
  fs.mkdirSync(path.dirname(CODE_FILE),{recursive:true});fs.writeFileSync(CODE_FILE,code,{mode:0o600});return code;
}
export function useLoginCode(code){
  const exp=codes.get(String(code||''));if(!exp)return false;codes.delete(String(code));
  if(Date.now()>exp)return false;try{fs.rmSync(CODE_FILE,{force:true});}catch{}return true;
}
const eq=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};
export const checkSecret=s=>eq(s,ensureSecret());
// CSRF token: derived from the session token, so the page can read it from /api/local/session.
export const csrfFor=sessionTok=>createHash('sha256').update(`${ensureSecret()}:${sessionTok}`).digest('base64url').slice(0,32);

// ---------------------------------------------------------------- request checks
export function checkRequest(req,pathname){
  if(!LOCAL)return;
  if(!allowedHosts().has(String(req.headers.host||'')))throw new HttpError(421,'This Duke backend only answers on this PC (http://127.0.0.1:'+LOCAL_PORT+').');
  const unsafe=!['GET','HEAD','OPTIONS'].includes(req.method);
  const origin=req.headers.origin;
  if(origin&&!allowedOrigins().has(origin))throw new HttpError(403,'Requests from other websites are refused.');
  if(!origin&&unsafe&&req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))throw new HttpError(403,'Cross-site request refused.');
  // Agents (the Duke app) talk to their own routes with their own token; nothing else needs an exception.
  void pathname;
}
export function checkUpgrade(req){
  if(!LOCAL)return true;
  if(!allowedHosts().has(String(req.headers.host||'')))return false;
  const o=req.headers.origin;return !o||allowedOrigins().has(o);
}
export function requireCsrf(req,sessionTok){
  if(!LOCAL)return;
  if(!eq(req.headers['x-duke-csrf'],csrfFor(sessionTok)))throw new HttpError(403,'Missing or wrong security token. Reload the page.');
}

// ---------------------------------------------------------------- outbound network guard
const ALLOW=new Set(String(process.env.DUKE_LOCAL_ALLOW_HOSTS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
let blockedLog=null;
export function installNetGuard(){
  if(!LOCAL||globalThis.__dukeNetGuard)return;
  fs.mkdirSync(LOG_DIR,{recursive:true});blockedLog=path.join(LOG_DIR,'blocked-network.jsonl');
  const orig=globalThis.fetch;globalThis.__dukeNetGuard=true;
  globalThis.fetch=async(input,init)=>{
    const u=new URL(typeof input==='string'?input:input.url);
    const h=u.hostname.toLowerCase();
    if(!isLoopback(h)&&!ALLOW.has(h)){
      fs.appendFileSync(blockedLog,JSON.stringify({at:new Date().toISOString(),url:`${u.protocol}//${u.host}${u.pathname}`})+'\n');
      throw new Error(`Duke Local blocks network calls to ${h}: everything runs on this PC. (Allow a host with DUKE_LOCAL_ALLOW_HOSTS if you really need it.)`);
    }
    return orig(input,init);
  };
}
export { isLoopback };
export function bootLocal(){if(!LOCAL)return;ensureSecret();installNetGuard();return newLoginCode();}
