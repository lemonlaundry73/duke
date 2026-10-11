// Subscriptions: plans, feature gates, monthly credits, Stripe Checkout + Customer Portal + webhooks.
// Zero dependencies: Stripe's REST API is called with fetch and webhooks are verified with HMAC-SHA256.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { load, mutate } from './store.js';
import { HttpError, readBody } from './http.js';
import { requireUser, isAdminEmail } from './auth.js';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

// Prices and the webhook secret Duke created for itself in Stripe (see stripeAutoSetup).
const AUTO_FILE=path.join(DATA_DIR,'stripe.json');
let AUTO={};try{AUTO=JSON.parse(fs.readFileSync(AUTO_FILE,'utf8'));}catch{}
const saveAuto=()=>{fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(AUTO_FILE,JSON.stringify(AUTO,null,2));};
const webhookSecret=()=>process.env.STRIPE_WEBHOOK_SECRET||AUTO.webhookSecret||'';

export const PLANS={
  free:   {id:'free',   name:'Free',   month:0,  credits:0,   projects:1, features:{build:false,course:false,expansion:false,cloud:false},
           blurb:'Plan your game: all of Phase 1, Duke the director, and the live preview of your world.'},
  creator:{id:'creator',name:'Creator',month:39, credits:300, projects:3, features:{build:true,course:false,expansion:false,cloud:false},
           blurb:'Build mode: all 67 gated steps, AI drafting, 3D generation credits and PC builds.'},
  academy:{id:'academy',name:'Academy',month:69, credits:300, projects:3, features:{build:true,course:true,expansion:false,cloud:false},
           blurb:'Everything in Creator plus Course mode: lessons on your own game, phase quizzes and certificates.'},
  studio: {id:'studio', name:'Studio', month:149,credits:1000,projects:10,features:{build:true,course:true,expansion:true,cloud:true},
           blurb:'Everything in Academy plus the AI expansion loop, cloud builds and more credits.'}
};
export const PLAN_ORDER=['free','creator','academy','studio'];
export const yearPrice=plan=>PLANS[plan].month*10; // two months free
// Credits per Meshy-backed job (3D generation has real per-use cost).
export const CREDIT_COST={concept:2,model:15,rig:5,anims:5};

const ACTIVE=['active','trialing','past_due'];
export function planOf(user){
  if(!user)return 'free';
  if(isAdminEmail(user.email))return 'studio';
  const s=user.sub;
  if(s&&ACTIVE.includes(s.status)&&PLANS[s.plan]&&(!s.currentPeriodEnd||Date.parse(s.currentPeriodEnd)>Date.now()-3*86400e3))return s.plan;
  return 'free';
}
export const can=(user,feature)=>!!PLANS[planOf(user)].features[feature];
export const minPlanFor=feature=>PLAN_ORDER.find(p=>PLANS[p].features[feature]);
export function requireFeature(user,feature,what){
  if(!can(user,feature)){const need=PLANS[minPlanFor(feature)];throw new HttpError(402,`${what||'This'} needs the ${need.name} plan or higher.`);}
}
const period=()=>new Date().toISOString().slice(0,7);
export function creditsLeft(user){
  const plan=PLANS[planOf(user)];const c=user.credits||{};
  const used=c.period===period()?c.used||0:0;
  return {plan:plan.id,total:plan.credits,used,left:Math.max(0,plan.credits-used)+(user.bonusCredits||0)};
}
// Deducts credits inside a mutate() callback. Throws 402 when the user cannot afford it.
export function spendCredits(db,userId,amount,what){
  const u=db.users?.[userId];if(!u)throw new HttpError(401,'Log in to continue');
  if(isAdminEmail(u.email))return;
  const plan=PLANS[planOf(u)];
  if(!plan.credits&&!(u.bonusCredits>0))throw new HttpError(402,`${what} uses 3D credits, which come with the Creator plan or higher.`);
  if(!u.credits||u.credits.period!==period())u.credits={period:period(),used:0};
  const left=plan.credits-u.credits.used;
  if(left>=amount){u.credits.used+=amount;return;}
  if((u.bonusCredits||0)+Math.max(0,left)>=amount){u.bonusCredits-=amount-Math.max(0,left);u.credits.used=plan.credits;return;}
  throw new HttpError(402,`Not enough credits for ${what} (needs ${amount}, ${Math.max(0,left)} left this month).`);
}

export function billingStatus(user){
  const plan=planOf(user);
  return {plan,planName:PLANS[plan].name,sub:user?.sub?{plan:user.sub.plan,status:user.sub.status,interval:user.sub.interval,currentPeriodEnd:user.sub.currentPeriodEnd,cancelAtPeriodEnd:!!user.sub.cancelAtPeriodEnd,test:!!user.sub.test}:null,
    credits:user?creditsLeft(user):null,features:PLANS[plan].features,trialAvailable:!!user&&!user.trialUsed,mode:billingMode()};
}

// ---------------------------------------------------------------- Stripe
const stripeKey=()=>process.env.STRIPE_SECRET_KEY||'';
export const billingMode=()=>stripeKey()?(stripeKey().startsWith('sk_live')?'live':'stripe-test'):process.env.BILLING_TEST_MODE==='1'?'test':'off';
const priceEnv=(plan,interval)=>process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval==='year'?'YEAR':'MONTH'}`]||AUTO.prices?.[`${plan}_${interval}`]||'';
function priceToPlan(priceId){
  for(const p of PLAN_ORDER)for(const i of ['month','year'])if(priceId&&priceEnv(p,i)===priceId)return {plan:p,interval:i};
  return null;
}
function form(obj,prefix='',out=[]){
  for(const [k,v] of Object.entries(obj)){if(v===undefined||v===null)continue;const key=prefix?`${prefix}[${k}]`:k;
    if(typeof v==='object')form(v,key,out);else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);}
  return out.join('&');
}
async function stripe(method,path,params){
  const r=await fetch(`${process.env.STRIPE_API_BASE||"https://api.stripe.com/v1"}/${path}`,{method,signal:AbortSignal.timeout(30000),
    headers:{authorization:`Bearer ${stripeKey()}`,'content-type':'application/x-www-form-urlencoded'},body:method==='GET'?undefined:form(params||{})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new HttpError(502,`Payment provider error: ${d.error?.message||r.status}`);
  return d;
}
export function verifyStripeSignature(raw,header,secret,tolerance=300){
  const parts=Object.fromEntries(String(header||'').split(',').map(x=>x.split('=')).filter(x=>x.length===2).map(([k,v])=>[k.trim(),v]).filter(([k])=>k==='t'));
  const sigs=String(header||'').split(',').map(x=>x.trim()).filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));
  const t=Number(parts.t);
  if(!t||!sigs.length)return false;
  if(Math.abs(Date.now()/1000-t)>tolerance)return false;
  const want=createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some(s=>s.length===want.length&&timingSafeEqual(Buffer.from(s),Buffer.from(want)));
}
function applySubscription(u,sub){
  const price=sub.items?.data?.[0]?.price;
  const mapped=priceToPlan(price?.id)||{};
  const plan=sub.metadata?.plan&&PLANS[sub.metadata.plan]?sub.metadata.plan:mapped.plan;
  const end=sub.current_period_end||sub.items?.data?.[0]?.current_period_end;
  u.sub={plan:plan||u.sub?.plan||'creator',status:sub.status,interval:price?.recurring?.interval||mapped.interval||'month',stripeSubscriptionId:sub.id,
    currentPeriodEnd:end?new Date(end*1000).toISOString():null,cancelAtPeriodEnd:!!sub.cancel_at_period_end};
  if(sub.status==='trialing'||sub.trial_end)u.trialUsed=true;
}
const origin=req=>process.env.SITE_URL?.replace(/\/$/,'')||`${req.headers['x-forwarded-proto']||'http'}://${req.headers['x-forwarded-host']||req.headers.host}`;

export function registerBilling(r){
  r.get('/api/billing/plans',()=>({plans:PLAN_ORDER.map(id=>({...PLANS[id],year:yearPrice(id)})),mode:billingMode(),creditCost:CREDIT_COST}));
  r.get('/api/billing/status',async({req})=>billingStatus(await requireUser(req)));

  r.post('/api/billing/checkout',async({req,body})=>{
    const user=await requireUser(req);
    const plan=String(body.plan||''),interval=body.interval==='year'?'year':'month';
    if(!PLANS[plan]||plan==='free')throw new HttpError(400,'Choose Creator, Academy or Studio');
    const mode=billingMode();
    if(mode==='off')throw new HttpError(503,'Payments are not set up on this server yet. The site owner needs to add Stripe keys.');
    if(mode==='test'){
      const trial=!user.trialUsed;
      const u=await mutate(db=>{const u=db.users[user.id];u.sub={plan,status:trial?'trialing':'active',interval,test:true,cancelAtPeriodEnd:false,
        currentPeriodEnd:new Date(Date.now()+(trial?7:interval==='year'?365:30)*86400e3).toISOString()};u.trialUsed=true;return u;});
      return {activated:true,status:billingStatus(u)};
    }
    const price=priceEnv(plan,interval);
    if(!price)throw new HttpError(503,`The ${PLANS[plan].name} ${interval}ly price is not configured (STRIPE_PRICE_${plan.toUpperCase()}_${interval==='year'?'YEAR':'MONTH'}).`);
    if(user.sub?.stripeSubscriptionId&&ACTIVE.includes(user.sub.status)){
      const portal=await stripe('POST','billing_portal/sessions',{customer:user.stripeCustomerId,return_url:`${origin(req)}/studio`});
      return {url:portal.url};
    }
    const params={mode:'subscription','line_items':{0:{price,quantity:1}},client_reference_id:user.id,allow_promotion_codes:'true',
      success_url:`${origin(req)}/studio?welcome=${plan}`,cancel_url:`${origin(req)}/pricing`,
      subscription_data:{metadata:{plan,userId:user.id},...(user.trialUsed?{}:{trial_period_days:7})},metadata:{plan,userId:user.id}};
    if(user.stripeCustomerId)params.customer=user.stripeCustomerId;else params.customer_email=user.email;
    const s=await stripe('POST','checkout/sessions',params);
    return {url:s.url};
  });

  r.post('/api/billing/portal',async({req})=>{
    const user=await requireUser(req);
    if(billingMode()==='test'){
      const u=await mutate(db=>{const u=db.users[user.id];if(u.sub){u.sub.status='canceled';u.sub.cancelAtPeriodEnd=false;}return u;});
      return {canceled:true,status:billingStatus(u)};
    }
    if(!user.stripeCustomerId)throw new HttpError(400,'No subscription to manage yet');
    const s=await stripe('POST','billing_portal/sessions',{customer:user.stripeCustomerId,return_url:`${origin(req)}/studio`});
    return {url:s.url};
  });

  r.post('/api/billing/webhook',async({req})=>{
    const secret=webhookSecret();
    if(!secret)throw new HttpError(503,'Stripe webhook secret is not set yet');
    const raw=(await readBody(req,1024*1024)).toString('utf8');
    if(!verifyStripeSignature(raw,req.headers['stripe-signature'],secret))throw new HttpError(400,'Invalid signature');
    const ev=JSON.parse(raw);
    let sub=null;
    if(ev.type==='checkout.session.completed'&&ev.data.object.subscription&&stripeKey())
      sub=await stripe('GET',`subscriptions/${ev.data.object.subscription}`);
    else if(/^customer\.subscription\./.test(ev.type))sub=ev.data.object;
    await mutate(db=>{
      db.stripeEvents ||= [];if(db.stripeEvents.includes(ev.id))return true;
      db.stripeEvents.push(ev.id);db.stripeEvents=db.stripeEvents.slice(-500);
      const o=ev.data.object;
      const userId=o.client_reference_id||o.metadata?.userId||sub?.metadata?.userId;
      const customer=o.customer||sub?.customer;
      const u=(userId&&db.users?.[userId])||Object.values(db.users||{}).find(x=>customer&&x.stripeCustomerId===customer);
      if(!u)return true;
      if(customer)u.stripeCustomerId=customer;
      if(sub)applySubscription(u,sub);
      return true;
    });
    return {received:true};
  });
}

// One-time Stripe setup, run at server start when STRIPE_SECRET_KEY and SITE_URL are set:
// creates the Duke Forge products and monthly/yearly prices (found again later by lookup key),
// the webhook endpoint (its secret is stored in DATA_DIR/stripe.json), and a Customer Portal
// configuration if the account has none. Safe to run on every start; it only fills what is missing.
export async function stripeAutoSetup(){
  const site=(process.env.SITE_URL||'').replace(/\/$/,'');
  if(!stripeKey())return;
  if(!site){console.warn('[stripe] Set SITE_URL so Duke can create its Stripe webhook.');return;}
  const q=o=>new URLSearchParams(o).toString();
  try{
    AUTO.prices ||= {};AUTO.products ||= {};
    for(const plan of ['creator','academy','studio'])for(const interval of ['month','year']){
      const k=`${plan}_${interval}`,lookup=`duke_forge_${k}`;
      if(process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`])continue;
      const found=await stripe('GET',`prices?${q({'lookup_keys[]':lookup,active:'true',limit:'1'})}`);
      if(found.data?.[0]){AUTO.prices[k]=found.data[0].id;continue;}
      if(!AUTO.products[plan]){const prod=await stripe('POST','products',{name:`Duke Forge ${PLANS[plan].name}`,description:PLANS[plan].blurb,metadata:{app:'duke-forge',plan}});AUTO.products[plan]=prod.id;}
      const amount=(interval==='year'?yearPrice(plan):PLANS[plan].month)*100;
      const price=await stripe('POST','prices',{product:AUTO.products[plan],currency:'usd',unit_amount:amount,recurring:{interval},lookup_key:lookup,nickname:`Duke Forge ${PLANS[plan].name} (${interval}ly)`,metadata:{app:'duke-forge',plan}});
      AUTO.prices[k]=price.id;console.log(`[stripe] created price ${lookup}`);
    }
    if(!process.env.STRIPE_WEBHOOK_SECRET){
      const url=`${site}/api/billing/webhook`;
      const list=await stripe('GET','webhook_endpoints?limit=100');
      const existing=(list.data||[]).find(w=>w.url===url);
      if(existing&&AUTO.webhookId!==existing.id){await stripe('DELETE',`webhook_endpoints/${existing.id}`);}
      if(!existing||AUTO.webhookId!==existing.id){
        const wh=await stripe('POST','webhook_endpoints',{url,description:'Duke Forge subscriptions',metadata:{app:'duke-forge'},
          enabled_events:{0:'checkout.session.completed',1:'customer.subscription.created',2:'customer.subscription.updated',3:'customer.subscription.deleted'}});
        AUTO.webhookId=wh.id;AUTO.webhookSecret=wh.secret;console.log('[stripe] created webhook',url);
      }
    }
    const portal=await stripe('GET','billing_portal/configurations?is_default=true&limit=1');
    if(!portal.data?.length){
      await stripe('POST','billing_portal/configurations',{business_profile:{headline:'Manage your Duke Forge plan'},
        features:{invoice_history:{enabled:'true'},payment_method_update:{enabled:'true'},subscription_cancel:{enabled:'true',mode:'at_period_end'}}});
      console.log('[stripe] created customer portal');
    }
    saveAuto();console.log('[stripe] ready');
  }catch(err){console.error('[stripe] setup failed:',err.message);saveAuto();}
}
