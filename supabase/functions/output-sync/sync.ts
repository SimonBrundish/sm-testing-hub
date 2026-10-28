// Pulls athletes, exercise definitions and test results from the Output Sports Open API.
// No Supabase or Deno imports here, so it can be tested on its own with a fake fetch and store.
// API: https://api.outputsports.com/swagger/index.html (v1.0)

export type Row = Record<string, unknown>;
export interface Store {
  upsert(table: string, rows: Row[]): Promise<void>;
  state(): Promise<{ synced_to: string | null } | null>;
  setState(s: Row): Promise<void>;
}
export interface Options {
  apiUrl: string;
  email: string;
  password: string;
  fetch: typeof fetch;
  store: Store;
  now?: Date;
  backfillDays?: number; // how far back to go the first time, or when asked to re-sync
  fromScratch?: boolean;
}

const DAY = 86400000;
const WINDOW_DAYS = 30;  // the API allows at most 31 days per measurements request
const OVERLAP_DAYS = 3;  // re-read the last few days in case results were edited or uploaded late

async function call(o: Options, path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await o.fetch(o.apiUrl.replace(/\/$/, '') + path, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init.token ? { Authorization: 'Bearer ' + init.token } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    const why = res.status === 401 ? 'Output did not accept the login'
      : res.status === 403 ? 'this Output account does not have API access'
      : `Output replied ${res.status}`;
    throw new Error(`${why} (${init.method || 'GET'} ${path})${text ? ': ' + text : ''}`);
  }
  return res.json();
}

const flat = (list: unknown) => Object.fromEntries(((list as { field?: string; value?: unknown }[]) || [])
  .filter(m => m && m.field && m.value != null).map(m => [m.field as string, m.value]));

export async function syncOutput(o: Options) {
  const now = o.now || new Date();
  const auth = await call(o, '/api/v1/oauth/token', { method: 'POST', body: { grantType: 'password', email: o.email, password: o.password } });
  const token = auth && auth.accessToken;
  if (!token) throw new Error('Output did not return an access token');

  const athletes = (await call(o, '/api/v1/athletes', { token })) as Row[];
  await o.store.upsert('gm_output_athletes', athletes.map(a => ({
    id: String(a.id), external_id: a.externalId ?? null, first_name: a.firstName ?? null, last_name: a.lastName ?? null,
    full_name: a.fullName ?? ([a.firstName, a.lastName].filter(Boolean).join(' ') || null),
    dob: typeof a.dateOfBirth === 'string' ? a.dateOfBirth.slice(0, 10) : null, synced_at: now.toISOString()
  })));

  const exercises = (await call(o, '/api/v1/exercises/metadata', { token })) as Row[];
  const circuits = (await call(o, '/api/v1/circuits/metadata', { token })) as Row[];
  await o.store.upsert('gm_output_exercises', [
    ...exercises.map(e => ({ id: String(e.id), kind: 'exercise', name: e.name ?? null, data: e, synced_at: now.toISOString() })),
    ...circuits.map(c => ({ id: String(c.id), kind: 'circuit', name: c.name ?? null, data: c, synced_at: now.toISOString() }))
  ]);

  const prev = o.fromScratch ? null : await o.store.state();
  let from = prev && prev.synced_to ? new Date(Date.parse(prev.synced_to) - OVERLAP_DAYS * DAY) : new Date(now.getTime() - (o.backfillDays ?? 365) * DAY);
  let measurements = 0;
  while (from < now) {
    const to = new Date(Math.min(from.getTime() + WINDOW_DAYS * DAY, now.getTime()));
    // Empty id lists mean every athlete and every exercise.
    const list = (await call(o, '/api/v1/exercises/measurements', { method: 'POST', token,
      body: { startDate: from.toISOString(), endDate: to.toISOString(), athleteIds: [], exerciseMetadataIds: [] } })) as Row[];
    const rows = list.filter(m => m.id && m.athleteId && m.exerciseId && m.completedDate).map(m => ({
      id: String(m.id), athlete_id: String(m.athleteId), exercise_id: String(m.exerciseId), completed_at: m.completedDate,
      variant: m.variant ?? null, metrics: flat(m.metrics), data: m, synced_at: now.toISOString()
    }));
    for (let i = 0; i < rows.length; i += 500) await o.store.upsert('gm_output_measurements', rows.slice(i, i + 500));
    measurements += rows.length;
    // Record progress after each window, so a timeout part way through picks up from here next time.
    await o.store.setState({ id: 'state', synced_to: to.toISOString() });
    from = to;
  }
  const counts = { athletes: athletes.length, exercises: exercises.length + circuits.length, measurements };
  await o.store.setState({ id: 'state', synced_to: now.toISOString(), last_run: now.toISOString(), last_ok: now.toISOString(), last_error: null, counts });
  return counts;
}
