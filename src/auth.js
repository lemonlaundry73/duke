// Accounts and sessions: scrypt password hashes, HttpOnly session cookies, per-user ownership.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { load, mutate } from './store.js';
import { HttpError, id as nanoid } from './http.js';

const SESSION_DAYS=30;
const COOKIE='duke_sid';
const now=()=>new Date().toISOString();

export function hashPassword(pw){
  const salt=randomBytes(16);const h=scryptSync(String(pw),salt,64);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw,stored){
  const [kind,salt,hash]=String(stored||'').split('$');if(kind!=='scrypt'||!salt||!hash)return false;
  const want=Buffer.from(hash,'base64');const got=scryptSync(String(pw),Buffer.from(salt,'base64'),want.length);
  return want.length===got.length&&timingSafeEqual(want,got);
}
export function parseCookies(req){
  const out={};for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i<0)continue;out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());}
  return out;
}
const secure=req=>(req.headers['x-forwarded-proto']||'').includes('https')||process.env.COOKIE_SECURE==='1';
export function sessionCookie(req,token,maxAge=SESSION_DAYS*86400){
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req)?'; Secure':''}`;
}

export const isAdminEmail=email=>(process.env.ADMIN_EMAILS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).includes(String(email||'').toLowerCase());
export const publicUser=u=>u&&({id:u.id,email:u.email,name:u.name,createdAt:u.createdAt,admin:isAdminEmail(u.email)});

export async function userFromRequest(req,db){
  const tok=parseCookies(req)[COOKIE];if(!tok)return null;
  db ||= await load();
  const s=db.sessions?.[tok];if(!s||Date.parse(s.exp)<Date.now())return null;
  return db.users?.[s.userId]||null;
}

// Simple in-memory throttle for login/signup: 10 attempts per 15 minutes per IP.
const attempts=new Map();
function throttle(req){
  const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  const t=Date.now();const a=(attempts.get(ip)||[]).filter(x=>t-x<15*60e3);
  if(a.length>=10)throw new HttpError(429,'Too many attempts. Wait 15 minutes and try again.');
  a.push(t);attempts.set(ip,a);
}
const validEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

async function createSession(db,userId){
  const tok=randomBytes(24).toString('base64url');
  db.sessions ||= {};db.sessions[tok]={userId,exp:new Date(Date.now()+SESSION_DAYS*86400e3).toISOString()};
  for(const [k,s] of Object.entries(db.sessions))if(Date.parse(s.exp)<Date.now())delete db.sessions[k];
  return tok;
}

export function registerAuth(r){
  r.post('/api/auth/signup',async({req,res,body})=>{
    throttle(req);
    const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||''),name=String(body.name||'').trim().slice(0,80);
    if(!validEmail(email))throw new HttpError(400,'Enter a valid email address');
    if(password.length<8)throw new HttpError(400,'Use a password with at least 8 characters');
    const out=await mutate(async db=>{
      db.users ||= {};
      if(Object.values(db.users).some(u=>u.email===email))throw new HttpError(409,'An account with this email already exists. Log in instead.');
      const u={id:nanoid(12),email,name:name||email.split('@')[0],pass:hashPassword(password),createdAt:now(),credits:{period:'',used:0}};
      db.users[u.id]=u;
      // The first account on a fresh server inherits projects made before accounts existed.
      if(Object.keys(db.users).length===1)for(const p of Object.values(db.projects||{}))if(!p.ownerId)p.ownerId=u.id;
      return {u,tok:await createSession(db,u.id)};
    });
    res.setHeader('set-cookie',sessionCookie(req,out.tok));
    return {user:publicUser(out.u)};
  });
  r.post('/api/auth/login',async({req,res,body})=>{
    throttle(req);
    const email=String(body.email||'').trim().toLowerCase();
    const out=await mutate(async db=>{
      const u=Object.values(db.users||{}).find(x=>x.email===email);
      if(!u||!verifyPassword(body.password,u.pass))throw new HttpError(401,'Wrong email or password');
      return {u,tok:await createSession(db,u.id)};
    });
    res.setHeader('set-cookie',sessionCookie(req,out.tok));
    return {user:publicUser(out.u)};
  });
  // Password reset: a one-hour link, emailed when an email service is set up, and always sent to the
  // owner's support inbox so a person can forward it.
  r.post('/api/auth/forgot',async({req,body})=>{
    throttle(req);const email=String(body.email||'').trim().toLowerCase();
    const site=(process.env.SITE_URL||`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`).replace(/\/$/,'');
    const out=await mutate(db=>{const u=Object.values(db.users||{}).find(x=>x.email===email);if(!u)return null;
      const tok=randomBytes(24).toString('base64url');db.resets ||= {};db.resets[tok]={userId:u.id,exp:new Date(Date.now()+3600e3).toISOString()};
      for(const [k,v] of Object.entries(db.resets))if(Date.parse(v.exp)<Date.now())delete db.resets[k];
      const link=`${site}/reset?token=${tok}`;db.tickets ||= {};const id=nanoid(6).toUpperCase();
      db.tickets[id]={id,userId:u.id,email,subject:'Password reset requested',summary:`${email} asked to reset their password. If they contact you, send them this one-hour link:\n${link}`,severity:'normal',status:'open',at:now(),actions:[],replies:[],transcript:[]};
      return {link,email};});
    if(out&&process.env.RESEND_API_KEY){
      try{await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${process.env.RESEND_API_KEY}`,'content-type':'application/json'},
        body:JSON.stringify({from:process.env.SUPPORT_FROM||'Duke Forger <support@dukeforger.com>',to:[out.email],subject:'Reset your Duke Forger password',text:`Click this link within one hour to choose a new password:\n${out.link}\n\nIf you didn't ask for this, ignore this email.`})});}catch{}
    }
    return {ok:true,emailed:!!process.env.RESEND_API_KEY};
  });
  r.post('/api/auth/reset',async({req,res,body})=>{
    throttle(req);const password=String(body.password||'');if(password.length<8)throw new HttpError(400,'Use a password with at least 8 characters');
    const out=await mutate(async db=>{const r=db.resets?.[String(body.token||'')];if(!r||Date.parse(r.exp)<Date.now())throw new HttpError(400,'This reset link expired. Ask for a new one.');
      const u=db.users[r.userId];u.pass=hashPassword(password);delete db.resets[String(body.token)];
      for(const [k,s] of Object.entries(db.sessions||{}))if(s.userId===u.id)delete db.sessions[k];
      return {u,tok:await createSession(db,u.id)};});
    res.setHeader('set-cookie',sessionCookie(req,out.tok));return {user:publicUser(out.u)};
  });
  r.post('/api/auth/logout',async({req,res})=>{
    const tok=parseCookies(req)[COOKIE];
    if(tok)await mutate(db=>{if(db.sessions)delete db.sessions[tok];return true;});
    res.setHeader('set-cookie',sessionCookie(req,'',0));
    return {ok:true};
  });
}

export async function requireUser(req){
  const u=req.user||await userFromRequest(req);
  if(!u)throw new HttpError(401,'Log in to continue');
  return u;
}
