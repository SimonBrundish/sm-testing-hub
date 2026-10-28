# Growth & Maturation dashboard: Supabase setup

The Supermovers Growth & Maturation dashboard is a static page hosted on GitHub Pages at
https://simonbrundish.github.io/sm-testing-hub/growth/ and embedded in the Squarespace site.
It will use the existing StrengthLab Supabase project for coach login and to store player data.
It only adds three new tables, all prefixed `gm_`, and doesn't change anything that's already there.

## 1. Create the tables
SQL Editor → New query → paste all of [`setup.sql`](setup.sql) → Run. It's safe to run more than once.

This creates `gm_coaches`, `gm_players` and `gm_settings`, with row level security turned on.
Having a StrengthLab login isn't enough to read player data. The user's email also has to be in `gm_coaches`.
Anonymous users can't read anything.

## 2. Point invite and password emails at the dashboard
Authentication → URL Configuration:
- **Site URL**: `https://simonbrundish.github.io/sm-testing-hub/growth/`. Invite emails always use this address, so if it's left as `http://localhost:3000` the links won't open.
- **Redirect URLs**: add the same address.

The "Forgot your password?" link on the dashboard sends coaches back to this address.

## 3. Add the coaches
For each coach:
1. Authentication → Users → Add user → Create new user. Enter their email and a temporary password, and tick "Auto Confirm User".
2. In the SQL Editor, run:
   `insert into public.gm_coaches (email) values ('coach@example.com');` (use lower case)

To remove a coach's access, delete their row from `gm_coaches`.

## 4. Send these two values to Simon
Find them under Project Settings → API (or Data API):
- **Project URL**, for example `https://abcd1234.supabase.co`
- **anon / publishable key**

Both are designed to appear in a public web page, and the security rules above are what protect the data.
**Never send the `service_role` or secret key.**

Once these are in, the dashboard shows a coach sign-in and every coach sees the same squad.
Password reset emails will use the StrengthLab project's email templates and sender.
