# Auto-Ops Sentinel

Auto-Ops Sentinel is an API health monitoring workspace with a local-SLM incident response loop backed by PostgreSQL:

- synthetic API monitor coverage
- incident cards with root-cause analysis and suggested fixes
- a natural-language signal analyst backed by a local Ollama-compatible model
- a lightweight Node backend that stores monitor history, incidents, and raw SLM sessions in PostgreSQL

## Run it

### Option 1: Docker (Recommended)

```sh
docker compose up
```

This will start:
- PostgreSQL database on port 5432
- Backend API on port 8787

Then in a new terminal:
```sh
npm run dev:client
```

### Option 2: Manual Setup

Open two terminals:

```sh
npm install
npm run dev:server
```

```sh
npm run dev:client
```

The frontend runs on `http://localhost:8080` and proxies `/api` calls to the backend on `http://127.0.0.1:8787`.
The backend now reads `.env` automatically when you start it with `npm run dev:server`.

## PostgreSQL

PostgreSQL is now the primary database for:

- monitors
- monitor checks and stored response bodies
- incidents
- activity events
- full Signal Analyst runs, including prompt and raw model output

Set this value in `.env`:

- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/auto_ops_sentinel`

Retention defaults to "keep everything". If you want limits, set:

- `CHECK_RETENTION_PER_MONITOR`
- `ANALYSIS_RETENTION_PER_MONITOR`
- `ACTIVITY_EVENT_RETENTION`

## Local SLM

The backend expects an Ollama-compatible endpoint by default:

- `SLM_BASE_URL=http://127.0.0.1:11434`
- `SLM_MODEL=llama3.2:3b`
- `SLM_TIMEOUT_MS=20000`

If the model is unavailable, the app falls back to a rule-based RCA engine so the dashboard still works.
If Ollama is already running on `127.0.0.1:11434`, do not start `ollama serve` again.

You can now change the SLM connection in the UI from the `SLM Settings` button:

- base URL
- model
- timeout

Those settings are saved in PostgreSQL and used for future analysis runs without editing code.

## Scripts

```sh
npm run dev:client
npm run dev:server
npm run build
npm run test
```

## Notes

- `src/pages/Index.tsx` is the active frontend entrypoint.
- `server/index.mjs` exposes the monitor, incident, RCA, natural-language query, and SLM settings endpoints.
- `server/store.mjs` owns the PostgreSQL connection, schema bootstrap, and persisted SLM settings.
- `server/slm.mjs` checks reachability, uses the persisted SLM settings, and stores full per-monitor analysis inputs and outputs.
