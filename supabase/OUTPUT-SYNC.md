# Output Sports sync: setup

This copies test results from the Output Sports Open API into the Supabase project once a day.
Coaches then choose which Output results feed which dashboard test on the **Data** tab, and add them to the players.
The Output login is kept as a server secret. It never reaches the browser or the GitHub repo.

You need the [Supabase CLI](https://supabase.com/docs/guides/cli) logged in to the project (`supabase link --project-ref msnazqefuanyodfzxlwl`).
Run `setup.sql` first if you haven't already.

## 1. Create the tables
SQL Editor → New query → paste all of [`output-setup.sql`](output-setup.sql) → Run. It's safe to run more than once.

This adds `gm_output_athletes`, `gm_output_exercises`, `gm_output_measurements` and `gm_output_sync`.
Coaches can read them. Only the sync function can write to them.

## 2. Set the secrets
Use an Output account with API access. A separate login just for the sync is best, so it can be changed without affecting anyone.

```
supabase secrets set OUTPUT_EMAIL='sync@example.com' OUTPUT_PASSWORD='...' SYNC_SECRET="$(openssl rand -hex 32)"
```

Keep a copy of the `SYNC_SECRET` value, because step 4 needs it.
To use a different API address, also set `OUTPUT_API_URL`. It defaults to `https://api.outputsports.com`.

## 3. Deploy the function
From the folder that contains `supabase/functions/output-sync`:

```
supabase functions deploy output-sync --no-verify-jwt
```

`--no-verify-jwt` is needed because the function does its own checks. It only runs for the daily job, which sends `SYNC_SECRET`, or for a signed-in user on the `gm_coaches` list.

To run the first sync, sign in to the dashboard, open **Data**, and press **Sync now**. The first run fetches the last 365 days.

## 4. Run it every morning
Database → Extensions: turn on `pg_cron` and `pg_net`. Then, in the SQL Editor, store the two values in Vault and schedule the job.
The commented block at the end of `output-setup.sql` has the exact SQL.

## Checking it
- The Data tab shows when the last sync ran and any error from it.
- **"this Output account does not have API access"** means Output needs to turn on API access for the login in `OUTPUT_EMAIL`.
- **"Output did not accept the login"** means `OUTPUT_EMAIL` or `OUTPUT_PASSWORD` is wrong.
- For a full re-sync, call the function with `{"fromScratch": true, "days": 730}`.

## How athletes are matched
An Output athlete is matched to a dashboard player in this order:
1. Output's **external ID** is the same as the dashboard player id.
2. Otherwise, the **name and date of birth** are the same in both. Accents, letter case and extra spaces are ignored.
3. Otherwise, the name alone, but only if it is unique and one side has no date of birth.

The Data tab lists any Output athletes it couldn't match.
