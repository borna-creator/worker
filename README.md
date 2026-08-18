# NumaIQ Worker (VPS 2)

Standalone service that receives QA jobs from the NumaIQ API (VPS 1), downloads call audio, transcribes with **Deepgram Nova-3**, scores with **DeepSeek**, and posts results back.

**Phase 3:** Per-scorecard Deepgram feature toggles (summarization, sentiment, diarization, redaction, etc.) configured in the NumaIQ UI under each scorecard.

## What you need

| Server | Role | Required env |
|--------|------|--------------|
| VPS 1 | NumaIQ API + UI | `WORKER_SECRET`, `WORKER_URL=http://<vps2-ip>:4000`, `API_DOMAIN` |
| VPS 2 | This worker | `WORKER_SECRET`, `DEEPGRAM_API_KEY`, `DEEPSEEK_API_KEY`, `WORKER_PORT=4000` |

Set `WORKER_MODE=mock` on VPS 2 to skip API keys and use placeholder transcript/scores (Phase 2 behavior).

Firewall:

- VPS 1 → VPS 2: port **4000** (job dispatch)
- VPS 2 → VPS 1: HTTPS to `API_DOMAIN` (audio download + callback)

## Deploy on VPS 2

```bash
# Option A: clone full repo, use only this folder
git clone https://github.com/<your-org>/numa-ai-public.git
cd numa-ai-public/vps2-worker

# Option B: copy only this folder to the server
# scp -r vps2-worker/ user@vps2:/var/www/numaiq-worker

npm ci
cp .env.example .env
# Edit .env — set WORKER_SECRET to match VPS 1

npm start
# Or with systemd (see deploy/numaiq-worker.service)
```

Verify from VPS 2:

```bash
curl http://127.0.0.1:4000/health
# {"status":"ok","mode":"live","version":"0.2.0",...}
```

On VPS 1, set in `.env`:

```env
WORKER_SECRET=<same-secret>
WORKER_URL=http://<vps2-public-ip>:4000
```

Restart the API: `sudo systemctl restart numaiq-api`

## Test end-to-end

1. Log in to NumaIQ, create a scorecard with a few criteria.
2. Upload a call and **select that scorecard**.
3. Call status: `PENDING → PROCESSING → COMPLETED`.
4. Open the call — transcript, AI summary (if enabled), sentiment, criterion scores, and overall %.

Worker logs on VPS 2:

```
✓ Job clx… completed (live)
```

## Local development (both servers on your machine)

**Terminal 1 — VPS 1 stack:**

```bash
cd ..   # repo root
cp .env.example .env
# WORKER_SECRET=dev-secret
# WORKER_URL=http://127.0.0.1:4000

npm run docker:up
npm run db:migrate:deploy
npm run dev:all   # web + API + worker (vps2-worker)
```

**Or run worker separately (Terminal 2):**

```bash
cd vps2-worker
cp .env.example .env   # same WORKER_SECRET as repo root .env
npm ci && npm run dev
```

Then upload a call with a scorecard at http://localhost:5173

## API contract

### Incoming — `POST /jobs`

Header: `X-Worker-Secret: <WORKER_SECRET>`

Body includes `jobId`, `audioUrl`, `callbackUrl`, and `scorecard` with criteria. Responds `202` immediately; processing runs async.

### Outgoing callback — `POST {callbackUrl}`

Header: `X-Worker-Secret: <WORKER_SECRET>`

Success:

```json
{
  "status": "COMPLETED",
  "transcript": {
    "fullText": "…",
    "segments": {
      "summary": "…",
      "sentiment": { "average": "neutral", "sentiment_score": -0.13 },
      "speakers": [{ "speaker": "speaker_0", "startSec": 0, "endSec": 4, "text": "…" }],
      "entities": [],
      "paragraphs": "…"
    }
  },
  "results": [{ "criterionId": "…", "value": "YES", "passed": true, "reasoning": "…" }]
}
```

Failure:

```json
{ "status": "FAILED", "errorMessage": "…" }
```

Full details: [../docs/PHASE-2.md](../docs/PHASE-2.md)

## Systemd (production)

```bash
sudo cp deploy/numaiq-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now numaiq-worker
sudo systemctl status numaiq-worker
```

Adjust `User` and `WorkingDirectory` in the unit file if your paths differ.
