// Supabase edge function: copies Output Sports test results into the gm_output_* tables.
// Deploy:  supabase functions deploy output-sync --no-verify-jwt
// Secrets: supabase secrets set OUTPUT_EMAIL=... OUTPUT_PASSWORD=... SYNC_SECRET=<long random string>
// Called daily by pg_cron (with the x-sync-secret header) or by a signed-in coach from the dashboard's Data tab.
// The Output login never leaves the server.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { syncOutput } from './sync.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) || '';

// Allowed: the scheduled job (shared secret), or a signed-in user on the coach list.
async function allowed(req: Request) {
  const secret = env('SYNC_SECRET');
  if (secret && req.headers.get('x-sync-secret') === secret) return true;
  const authz = req.headers.get('Authorization') || '';
  if (!authz.startsWith('Bearer ')) return false;
  const asUser = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: authz } }, auth: { persistSession: false } });
  const { data, error } = await asUser.rpc('gm_is_coach');
  return !error && data === true;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST' });
  if (!(await allowed(req))) return reply(401, { error: 'Only coaches can run the Output sync' });
  if (!env('OUTPUT_EMAIL') || !env('OUTPUT_PASSWORD')) return reply(500, { error: 'OUTPUT_EMAIL and OUTPUT_PASSWORD are not set on the server' });

  const body = await req.json().catch(() => ({}));
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const store = {
    async upsert(table: string, rows: Record<string, unknown>[]) {
      if (!rows.length) return;
      const { error } = await db.from(table).upsert(rows);
      if (error) throw new Error(`Saving to ${table} failed: ${error.message}`);
    },
    async state() {
      const { data } = await db.from('gm_output_sync').select('synced_to').eq('id', 'state').maybeSingle();
      return data;
    },
    async setState(s: Record<string, unknown>) {
      const { error } = await db.from('gm_output_sync').upsert(s);
      if (error) throw new Error(`Saving sync state failed: ${error.message}`);
    }
  };
  try {
    const counts = await syncOutput({
      apiUrl: env('OUTPUT_API_URL') || 'https://api.outputsports.com',
      email: env('OUTPUT_EMAIL'), password: env('OUTPUT_PASSWORD'), fetch, store,
      backfillDays: Math.min(Math.max(+body.days || 365, 1), 3650), fromScratch: !!body.fromScratch
    });
    return reply(200, { ok: true, ...counts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from('gm_output_sync').upsert({ id: 'state', last_run: new Date().toISOString(), last_error: msg });
    return reply(502, { error: msg });
  }
});
