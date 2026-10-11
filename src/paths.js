import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Load .env before anything reads configuration (real env vars win).
try { process.loadEnvFile(path.join(ROOT,'.env')); } catch {}
// DATA_DIR can point at a persistent disk (e.g. Render disk mounted at /var/data).
const base=process.env.DATA_DIR?path.resolve(process.env.DATA_DIR):ROOT;
export const DATA_DIR=process.env.DATA_DIR?base:path.join(ROOT,'data');
export const UPLOAD_DIR=path.join(base,'uploads');
export const EXPORT_DIR=path.join(base,'exports');
export const PUBLIC_DIR=path.join(ROOT,'public');
