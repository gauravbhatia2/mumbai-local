# Production launch runbook

## 1. Repository and hosting

1. Create a GitHub repository for this project.
2. Push the code to the production branch you want Vercel to deploy from.
3. Import the repo into Vercel and keep the first launch on the default `vercel.app` domain.

## 2. Supabase bootstrapping

1. Create a Supabase project dedicated to this app.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Confirm these objects exist:
   - `stations`
   - `trains_current`
   - `trains_new`
   - `stops_current`
   - `stops_new`
   - `refresh_state`
   - `refresh_status_view`
   - `search_trains`

## 3. Secrets and environment variables

### Vercel project environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REFRESH_STALE_HOURS=36`

### GitHub Actions repository secrets

- `SUPABASE_DATABASE_URL`
- `TIMETABLE_SOURCE_URL`

Use the official Central Railway timetable landing page for `TIMETABLE_SOURCE_URL`:

```text
https://cr.indianrailways.gov.in/view_section.jsp?id=0,5,2360&lang=0
```

### Local-only variables

- `DATABASE_URL`
- `TIMETABLE_SOURCE_PATH`

## 4. First production data load

1. Set `DATABASE_URL` locally or run the GitHub Action manually with `workflow_dispatch`.
2. Install the parser dependency locally with `python -m pip install -r requirements-parser.txt`.
3. Run `python scripts/parse-central-railway.py "https://cr.indianrailways.gov.in/view_section.jsp?id=0,5,2360&lang=0" data/central-railway-parsed.csv`.
4. Run `npm.cmd run ingest` with `TIMETABLE_SOURCE_URL` blank and `TIMETABLE_SOURCE_PATH=data/central-railway-parsed.csv`.
5. Confirm `refresh_state.active_slot` flipped to the newly loaded slot.
6. Open `/api/health` and check:
   - `appStatus` is `ok` or `degraded`
   - `freshness.status` is `success`
   - `freshness.lastUpdatedAt` is recent

If GitHub Actions cannot reach `cr.indianrailways.gov.in`, the scheduled workflow will continue by using the checked-in `data/central-railway-parsed.csv` fallback. Update that file whenever you run the parser successfully from a machine that can reach the official source.

## 5. Rollback

If a bad load is activated, flip the slot manually in Supabase:

```sql
update refresh_state
set active_slot = case active_slot when 'current' then 'new' else 'current' end
where singleton = true;
```

Then verify `/api/health` and a few route searches again.

## 6. Secret rotation

1. Rotate the Supabase service-role key or database password in Supabase.
2. Update the matching Vercel environment variables and GitHub repository secrets.
3. Redeploy Vercel if required.
4. Trigger `workflow_dispatch` once to confirm the pipeline still works.
