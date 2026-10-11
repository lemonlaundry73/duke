// Shared lookups: a project's owner, the owner's plan, the owner's build agent, and settling progress.
import { planOf } from './billing.js';
import { advance, ensureRoadmap } from './progress.js';
import { ensureDesign } from './pipeline.js';

export const agentFor=(db,userId)=>Object.values(db.agents||{}).find(a=>a.userId===userId)||null;
export const ownerOf=(db,p)=>db.users?.[p.ownerId]||null;
export const ownerPlan=(db,p)=>planOf(ownerOf(db,p));
export function ctxFor(db,p){const agent=agentFor(db,p.ownerId);return {agent,inspect:agent?.inspect?.[p.id]||null};}
// Attaches agent info used by the legacy pipeline checklist, then stamps roadmap progress.
export function settle(db,p){
  ensureDesign(p);ensureRoadmap(p);
  const agent=agentFor(db,p.ownerId);
  p.agentSeenAt=agent?.seenAt||null;p.agentMachine=agent?.machine||null;
  return advance(p,ownerPlan(db,p),ctxFor(db,p));
}
