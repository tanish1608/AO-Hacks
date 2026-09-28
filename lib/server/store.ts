import { env } from 'cloudflare:workers';
import { HttpError } from './security';
export function database(){const db=(env as unknown as {DB:D1Database}).DB;if(!db)throw new HttpError(503,'Workspace storage is unavailable');return db;}
