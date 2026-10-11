import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

const DB=path.join(DATA_DIR,'db.json');
const seed=()=>({projects:{},jobs:{},events:[]});
let queue=Promise.resolve();

export async function load(){
  try { return JSON.parse(await fs.readFile(DB,'utf8')); }
  catch(err){
    if(err.code!=='ENOENT') throw err; // never overwrite a database we failed to parse
    const db=seed(); await save(db); return db;
  }
}
export async function save(db){
  await fs.mkdir(path.dirname(DB),{recursive:true});
  const tmp=`${DB}.${process.pid}.tmp`;
  await fs.writeFile(tmp,JSON.stringify(db,null,2));
  await fs.rename(tmp,DB);
}
// Serialized read-modify-write. Return null/undefined from fn to signal "not found".
export function mutate(fn){
  const run=queue.then(async()=>{const db=await load();const out=await fn(db);await save(db);return out;});
  queue=run.catch(()=>{});
  return run;
}
