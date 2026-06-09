# Receipt parse + Celery performance demo

One command: API benchmark + **fully automated** iOS Simulator UI + screen recording (no login, no taps).

## Prerequisites

- Docker Desktop
- Xcode + iOS Simulator
- Node.js (for Expo)
- `backend/.env` with **uncommented**:
  ```env
  TEST_PHONE_NUMBERS=["+15555550999"]
  TEST_OTP_CODE=424242
  OTP_DEV_MODE=true
  CELERY_BROKER_URL=redis://redis:6379/0
  ```
- Optional: `OPENAI_API_KEY` for a full receipt parse (enqueue timing works without it)

## Run (full automated demo + recording)

From the **repo root**:

```bash
chmod +x scripts/run_perf_demo.sh
./scripts/run_perf_demo.sh
```

### What happens

1. Starts Docker: `api`, `redis`, `db`, `worker-parse`, `worker-sms`
2. Seeds test user for `+15555550999`
3. Runs API benchmark (`enqueue_ms` vs `sync_total_ms`) and writes JWT to `/tmp/settld_demo_token.txt`
4. Copies demo receipt image from the API container into the React Native bundle
5. Boots iOS Simulator and **starts screen recording**
6. Launches Expo with auto-login + auto navigation to scan receipt + async parse
7. Stops recording when the app logs `DEMO_PERF_UI_COMPLETE` (not a fixed 5‑minute cap)
8. Saves `.mp4` under `demo-recordings/` and opens it in Finder

You do **not** need to log in, pick photos, or press Ctrl+C.

### Where the video is saved

| Location | Path |
|----------|------|
| Mac (default) | `SetId/demo-recordings/settld-perf-demo-YYYYMMDD-HHMMSS.mp4` |
| Simulator | Same file is also added to the **Photos** app on the booted simulator |

Override folder:

```bash
DEMO_RECORD_DIR=~/Desktop ./scripts/run_perf_demo.sh
```

## API-only (no simulator / no video)

```bash
SKIP_EXPO=1 ./scripts/run_perf_demo.sh
```

## Flags

| Env | Effect |
|-----|--------|
| `SKIP_DOCKER=1` | API already running on `:8000` |
| `SKIP_EXPO=1` | Terminal API demo only |
| `SKIP_RECORD=1` | No simulator screen capture |
| `DEMO_RECORD_DIR` | Custom output folder for `.mp4` |
| `MAX_UI_WAIT_SEC` | Max wait for UI auto-demo (default `600`) |
| `DEMO_API_URL` | Default `http://127.0.0.1:8000` |
| `SETLD_DEMO_TOKEN_FILE` | JWT path for app auto-login (default `/tmp/settld_demo_token.txt`) |

## How auto-login works

- `demo_receipt_perf.py` writes a JWT after test-phone OTP
- `run_perf_demo.sh` copies it from the API container to the host
- Expo starts with `EXPO_PUBLIC_DEMO_AUTO_RUN=1` and `EXPO_PUBLIC_DEMO_AUTO_TOKEN=<jwt>`
- `DemoPerfController` creates a bill, opens `ScanReceipt` with `autoRun: true`, uploads the bundled receipt, and runs async parse

## Physical iPhone (not simulator)

The script records the **Simulator** only. On a real device use iOS Screen Recording or QuickTime, and point Expo at your Mac API with `EXPO_PUBLIC_API_URL=http://<lan-ip>:8000`.

## Troubleshooting

### `send-otp` fails

Ensure **active** (not `# commented`) `TEST_PHONE_NUMBERS` in `backend/.env`, then:

```bash
cd backend && docker compose up -d --force-recreate api
```

### UI demo times out

Check `/tmp/settld_expo_demo.log` for `DEMO_PERF_UI_FAILED`. Ensure `/tmp/settld_demo_token.txt` exists after the API step.

### Recording file is 0 bytes

Simulator must be **booted** before recording starts. Re-run the script.
