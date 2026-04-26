# Mumbai Local Smart Train Finder

Production-ready MVP for a fast Mumbai local search experience built with:

- Next.js App Router on Vercel
- Supabase Postgres for search data
- GitHub Actions for the daily 3:00 AM IST refresh
- A double-buffer dataset strategy so refreshes swap instantly with no downtime
- Strict production mode that refuses to serve demo data when live config is missing

## What ships in this repo

- `app/` contains the commuter-facing search UI and `/api/trains`
- `app/api/health/route.ts` exposes operational health and refresh status
- `supabase/schema.sql` creates the schema, indexes, live views, and `search_trains` function
- `supabase/search-query.sql` shows the core indexed join behind route lookups
- `scripts/parse-central-railway.py` parses the official Central Railway timetable PDFs into a normalized CSV
- `scripts/ingest-timetable.mjs` downloads or reads CSV data, normalizes it, validates it, and activates the inactive slot
- `.github/workflows/refresh-timetable.yml` runs the parser plus ingest job every day at `30 21 * * *`, which is 3:00 AM IST
- `docs/production-launch.md` is the production rollout runbook

## Environment variables

Create a local `.env.local` from `.env.example`:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=...
TIMETABLE_SOURCE_URL=https://cr.indianrailways.gov.in/view_section.jsp?id=0,5,2360&lang=0
TIMETABLE_SOURCE_PATH=data/central-railway-parsed.csv
REFRESH_STALE_HOURS=36
```

Notes:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are used by the Vercel-hosted app for read-only server-side queries.
- `DATABASE_URL` is used by the GitHub Action ingestion job to write directly into Supabase Postgres.
- `TIMETABLE_SOURCE_URL` should point to the official Central Railway timetable landing page. The parser resolves the linked PDFs and writes a normalized CSV.
- `TIMETABLE_SOURCE_PATH` is the parser output path in production, or a local fallback CSV path for manual testing.
- `REFRESH_STALE_HOURS` controls when the app marks live timetable data as degraded. Default: `36`.

## Local development

```bash
npm install
npm run dev
```

If Supabase variables are not configured, the app falls back to a built-in demo timetable so the UI still works locally.
In production, demo fallback is disabled and the app returns a maintenance/degraded state instead.

## Supabase setup

1. Create a new Supabase project.
2. Open the SQL editor and run `supabase/schema.sql`.
3. Copy the Postgres connection string into `DATABASE_URL`.
4. Copy the project URL and service role key into `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
5. Verify the `refresh_status_view` and `search_trains` function were created successfully.
6. Run `python -m pip install -r requirements-parser.txt` if you want to execute the official parser locally.

## Vercel deployment

1. Import this repository into Vercel.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the Vercel project environment.
3. Optionally set `REFRESH_STALE_HOURS=36`.
4. Deploy the app.
5. Verify `/api/health` returns `appStatus: "ok"` or `appStatus: "degraded"` with a useful message.
6. The Vercel API route `/api/trains?from=Dadar&to=Thane&time=06:20&originOnly=true` will now search live data.

## GitHub Actions setup

Add these repository secrets:

- `SUPABASE_DATABASE_URL`
- `TIMETABLE_SOURCE_URL`

The workflow is already configured to:

1. Run daily at 3:00 AM IST.
2. Parse the official Central Railway PDFs into `data/central-railway-parsed.csv`.
3. Normalize station and train rows.
4. Validate source rows before any slot truncation.
5. Load the inactive dataset slot.
6. Validate train and stop counts.
7. Flip `refresh_state.active_slot` so the live app reads the new dataset instantly.
8. Leave the live slot untouched if the refresh fails.

If GitHub's runner cannot reach the official railway host on a given day, the workflow falls back to the checked-in `data/central-railway-parsed.csv` so the scheduled refresh still succeeds with the last known good official dataset.

## Data model

- `stations(id, slug, name, line)`
- `trains_current(id, name, origin_station_id, destination_station_id, type)`
- `trains_new(id, name, origin_station_id, destination_station_id, type)`
- `stops_current(id, train_id, station_id, arrival_time, departure_time, stop_order)`
- `stops_new(id, train_id, station_id, arrival_time, departure_time, stop_order)`
- `refresh_state(singleton, active_slot, last_refresh_started_at, last_refresh_completed_at, last_refresh_status, last_refresh_message, source_checksum)`
- `refresh_status_view(active_slot, last_refresh_started_at, last_refresh_completed_at, last_refresh_status, last_refresh_message, source_checksum)`

## Why the search stays fast

- The API never scrapes.
- The route only hits indexed Postgres tables.
- Search uses two indexed stop joins with `source_stop.stop_order < destination_stop.stop_order`.
- Results are capped at 15 rows.
- Station lists and refresh metadata are cached on the server with `unstable_cache`.
- Production marks data as degraded when the last successful refresh is older than `REFRESH_STALE_HOURS`.

## Health checks

- `GET /api/health` returns:
  - app status
  - whether Supabase search dependencies are configured
  - whether demo data is allowed
  - refresh freshness metadata
- `GET /api/trains` returns `503` in production if Supabase is not configured.

## Manual parser run

```bash
python scripts/parse-central-railway.py \
  "https://cr.indianrailways.gov.in/view_section.jsp?id=0,5,2360&lang=0" \
  data/central-railway-parsed.csv
```

Then load the generated CSV into Supabase:

```bash
TIMETABLE_SOURCE_URL= \
TIMETABLE_SOURCE_PATH=data/central-railway-parsed.csv \
npm run ingest
```

## Suggested next steps

- Add synthetic monitoring to verify the 3:00 AM IST refresh completes successfully.
- Expand the parser to cover Western Railway if you want a full citywide launch beyond Central Railway-operated lines.

See `docs/production-launch.md` for the first production rollout checklist, secret setup, manual ingestion flow, and rollback steps.
