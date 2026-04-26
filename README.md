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

The application uses a custom Python FastAPI server to serve a fine-tuned LLaMA 3.2 3B model (with PEFT LoRA adapters) for highly accurate incident response and conversational analysis. **Note:** Ensure your HuggingFace environment is authenticated if downloading base models for the first time.

### Setting up the Python Model Server

1. Activate your Python environment:
   ```sh
   source .venv/bin/activate
   ```
2. Start the local API server:
   ```sh
   python server.py
   ```
The Python server exposes an OpenAI-compatible `/chat/completions` API on `http://127.0.0.1:8000`. By default, the model runs on the CPU to prevent out-of-memory errors on 6GB GPUs, so generating responses may take a few minutes per message.

### Node Backend Settings

Ensure your `.env` is configured correctly to communicate with the local Python server without hitting early timeout limits:

- `SLM_BASE_URL=http://127.0.0.1:8000`
- `SLM_PROVIDER=openai-compatible`
- `SLM_MODEL=llama3.2:3b`
- `SLM_TIMEOUT_MS=300000` (5 minutes)

If the model is unavailable or taking too long, the app safely falls back to a rule-based RCA engine so the dashboard remains functional.

You can also change the SLM connection dynamically in the UI using the `SLM Settings` button. Those settings are gracefully saved in PostgreSQL for future analysis runs.

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
