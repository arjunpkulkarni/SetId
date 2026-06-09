#!/usr/bin/env bash
# End-to-end performance demo: Docker stack + API timing proof + iOS Simulator + screen recording.
#
# Usage (from repo root):
#   chmod +x scripts/run_perf_demo.sh
#   ./scripts/run_perf_demo.sh
#
# Optional env:
#   DEMO_PHONE=+15555550999   TEST_OTP_CODE=424242 in backend/.env
#   SKIP_DOCKER=1             API already running
#   SKIP_EXPO=1               API-only demo
#   SKIP_RECORD=1             No simulator screen recording
#   DEMO_RECORD_DIR=...       Where to save .mp4 (default: repo/demo-recordings)
#   MAX_UI_WAIT_SEC=600       Max wait for automated UI demo (default 10 min)
#   DEMO_SIM_DEVICE=iPhone 16e  Simulator to boot for recording

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${REPO_ROOT}/backend"
RN_APP="${REPO_ROOT}/frontend/ReactNativeApp"
DEMO_PHONE="${DEMO_PHONE:-+15555550999}"
API_URL="${DEMO_API_URL:-http://127.0.0.1:8000}"

RECORD_PID=""
RECORD_FILE=""
EXPO_LOG="${SETLD_EXPO_DEMO_LOG:-/tmp/settld_expo_demo.log}"
MAX_UI_WAIT_SEC="${MAX_UI_WAIT_SEC:-600}"
DEMO_SIM_DEVICE="${DEMO_SIM_DEVICE:-iPhone 16e}"
DEMO_SIM_UDID=""

# Note: `simctl spawn booted` often fails with "No such file or directory" even when
# the simulator is running — use booted-device JSON + stored UDID instead.
has_booted_sim() {
  if [[ -n "${DEMO_SIM_UDID}" ]]; then
    xcrun simctl list devices booted -j 2>/dev/null \
      | grep -q "\"${DEMO_SIM_UDID}\"" && return 0
  fi
  xcrun simctl list devices booted 2>/dev/null | grep -q '(Booted)'
}

booted_sim_udid() {
  if [[ -n "${DEMO_SIM_UDID}" ]] && has_booted_sim; then
    echo "${DEMO_SIM_UDID}"
    return 0
  fi
  DEMO_SIM_DEVICE="${DEMO_SIM_DEVICE}" python3 - <<'PY'
import json, os, subprocess
want = os.environ.get("DEMO_SIM_DEVICE", "iPhone 16e")
raw = subprocess.check_output(["xcrun", "simctl", "list", "devices", "booted", "-j"], text=True)
data = json.loads(raw)
for devs in data.get("devices", {}).values():
    for d in devs:
        if d.get("state") == "Booted":
            print(d["udid"])
            raise SystemExit(0)
sys.exit(1)
PY
}

resolve_sim_udid() {
  DEMO_SIM_DEVICE="${DEMO_SIM_DEVICE}" python3 - <<'PY'
import json, os, subprocess, sys
want = os.environ.get("DEMO_SIM_DEVICE", "iPhone 16e")
raw = subprocess.check_output(
    ["xcrun", "simctl", "list", "devices", "available", "-j"], text=True
)
data = json.loads(raw)
candidates = []
for runtime, devs in data.get("devices", {}).items():
    if "iOS" not in runtime and "iphone" not in runtime.lower():
        continue
    for d in devs:
        if d.get("isAvailable"):
            candidates.append((d.get("name", ""), d["udid"]))
for name, udid in candidates:
    if name == want:
        print(udid)
        sys.exit(0)
for name, udid in candidates:
    if "iphone" in name.lower():
        print(udid)
        sys.exit(0)
sys.exit(1)
PY
}

boot_demo_simulator() {
  if ! command -v xcrun >/dev/null 2>&1; then
    echo "✗ xcrun not found — install Xcode for the iOS Simulator"
    return 1
  fi
  local udid
  udid="$(booted_sim_udid 2>/dev/null)" || udid=""
  if [[ -n "${udid}" ]]; then
    DEMO_SIM_UDID="${udid}"
    echo "▶ Simulator already running (${DEMO_SIM_DEVICE})"
    return 0
  fi
  if ! udid="$(resolve_sim_udid)"; then
    echo "✗ No available iOS Simulator found"
    return 1
  fi
  DEMO_SIM_UDID="${udid}"
  echo "▶ Booting simulator “${DEMO_SIM_DEVICE}”…"
  xcrun simctl boot "${udid}" 2>/dev/null || true
  open -a Simulator 2>/dev/null || true
  if ! xcrun simctl bootstatus "${udid}" -b 2>/dev/null; then
    for _ in $(seq 1 60); do
      if has_booted_sim; then
        echo "   Simulator ready."
        return 0
      fi
      sleep 2
    done
    echo "✗ Simulator did not finish booting"
    return 1
  fi
  echo "   Simulator ready."
  return 0
}

stop_sim_recording() {
  if [[ -n "${RECORD_PID}" ]] && kill -0 "${RECORD_PID}" 2>/dev/null; then
    echo ""
    echo "▶ Stopping screen recording…"
    kill -INT "${RECORD_PID}" 2>/dev/null || true
    wait "${RECORD_PID}" 2>/dev/null || true
    RECORD_PID=""
    sleep 1
  fi
  if [[ -n "${RECORD_FILE}" && -f "${RECORD_FILE}" ]]; then
    local size=0
    size="$(wc -c < "${RECORD_FILE}" | tr -d ' ')"
    if [[ "${size}" -lt 4096 ]]; then
      echo "✗ Recording file is too small (${RECORD_FILE}, ${size} bytes) — capture may have failed"
      return 0
    fi
    echo "▶ Recording saved: ${RECORD_FILE} ($(du -h "${RECORD_FILE}" | awk '{print $1}'))"
    if has_booted_sim; then
      if xcrun simctl addmedia booted "${RECORD_FILE}" 2>/dev/null; then
        echo "▶ Added to Simulator → Photos app"
      fi
    fi
    if [[ "$(uname)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
      open -R "${RECORD_FILE}" 2>/dev/null || open "$(dirname "${RECORD_FILE}")" 2>/dev/null || true
    fi
  elif [[ "${SKIP_RECORD:-0}" != "1" ]]; then
    echo "✗ No screen recording was saved (simulator was not recording during the demo)"
  fi
}

start_sim_recording() {
  if [[ "${SKIP_RECORD:-0}" == "1" ]]; then
    return 0
  fi
  if ! command -v xcrun >/dev/null 2>&1; then
    echo "[demo] xcrun not found — skipping screen recording (need Xcode)"
    return 1
  fi
  local io_target udid
  if ! has_booted_sim; then
    return 1
  fi
  udid="$(booted_sim_udid 2>/dev/null)" || udid="${DEMO_SIM_UDID}"
  if [[ -z "${udid}" ]]; then
    io_target="booted"
  else
    io_target="${udid}"
    DEMO_SIM_UDID="${udid}"
  fi
  if [[ -n "${RECORD_PID}" ]] && kill -0 "${RECORD_PID}" 2>/dev/null; then
    return 0
  fi

  local record_dir="${DEMO_RECORD_DIR:-${REPO_ROOT}/demo-recordings}"
  mkdir -p "${record_dir}"
  RECORD_FILE="${record_dir}/settld-perf-demo-$(date +%Y%m%d-%H%M%S).mp4"

  echo "▶ Screen recording → ${RECORD_FILE}"
  echo "   (device ${DEMO_SIM_DEVICE}, stops when demo completes)"
  if ! xcrun simctl io "${io_target}" recordVideo "${RECORD_FILE}" >/tmp/settld_sim_record.log 2>&1 &
  then
    echo "✗ simctl recordVideo failed:"
    cat /tmp/settld_sim_record.log 2>/dev/null || true
    RECORD_PID=""
    RECORD_FILE=""
    return 1
  fi
  RECORD_PID=$!
  sleep 2
  if ! kill -0 "${RECORD_PID}" 2>/dev/null; then
    echo "✗ simctl recordVideo exited immediately:"
    cat /tmp/settld_sim_record.log 2>/dev/null || true
    RECORD_PID=""
    RECORD_FILE=""
    return 1
  fi
  return 0
}

try_start_sim_recording() {
  if [[ "${SKIP_RECORD:-0}" == "1" ]]; then
    return 0
  fi
  if [[ -n "${RECORD_PID}" ]] && kill -0 "${RECORD_PID}" 2>/dev/null; then
    return 0
  fi
  if has_booted_sim; then
    start_sim_recording
  else
    return 1
  fi
}

trap stop_sim_recording EXIT INT TERM

echo "═══════════════════════════════════════════════════════════"
echo "  Settld — async receipt parse + Celery performance demo"
echo "═══════════════════════════════════════════════════════════"

ensure_test_phone_in_env() {
  local env_file="${BACKEND}/.env"
  if [[ ! -f "${env_file}" ]]; then
    cp "${BACKEND}/.env.example" "${env_file}"
    echo "[demo] Created ${env_file} from .env.example"
  fi
  if ! grep -qE '^TEST_PHONE_NUMBERS=' "${env_file}" 2>/dev/null; then
    echo "" >> "${env_file}"
    echo "# Added by scripts/run_perf_demo.sh" >> "${env_file}"
    echo "TEST_PHONE_NUMBERS=[\"${DEMO_PHONE}\"]" >> "${env_file}"
    echo "[demo] Added TEST_PHONE_NUMBERS to .env"
  fi
  if ! grep -qE '^TEST_OTP_CODE=' "${env_file}" 2>/dev/null; then
    echo "TEST_OTP_CODE=424242" >> "${env_file}"
    echo "[demo] Added TEST_OTP_CODE=424242 to .env"
  fi
  if ! grep -qE '^OTP_DEV_MODE=' "${env_file}" 2>/dev/null; then
    echo "OTP_DEV_MODE=true" >> "${env_file}"
    echo "[demo] Added OTP_DEV_MODE=true (local SMS bypass fallback)"
  fi
  if ! grep -qE '^CELERY_BROKER_URL=' "${env_file}" 2>/dev/null; then
    echo "CELERY_BROKER_URL=redis://redis:6379/0" >> "${env_file}"
  fi
}

if [[ "${SKIP_DOCKER:-0}" != "1" ]]; then
  if ! docker info >/dev/null 2>&1; then
    echo ""
    echo "✗ Docker is not running."
    echo "  1. Open Docker Desktop (Applications → Docker)"
    echo "  2. Wait until the whale icon says “Docker Desktop is running”"
    echo "  3. Re-run: ../scripts/run_perf_demo.sh   (from backend/)"
    echo "     or:  ./scripts/run_perf_demo.sh       (from repo root)"
    echo ""
    echo "  API-only without Docker: SKIP_DOCKER=1 SKIP_EXPO=1 ../scripts/run_perf_demo.sh"
    echo "  (requires API already listening on ${API_URL})"
    exit 1
  fi
  ensure_test_phone_in_env
  echo ""
  echo "▶ Starting Postgres, Redis, API, worker-parse, worker-sms…"
  cd "${BACKEND}"
  docker compose up -d --build
  docker compose up -d --force-recreate api worker-parse worker-sms
  echo "▶ Waiting for API health…"
  for i in $(seq 1 40); do
    if curl -sf "${API_URL}/health" >/dev/null 2>&1; then
      echo "   API is up."
      break
    fi
    sleep 2
    if [[ "$i" -eq 40 ]]; then
      echo "   API did not become healthy in time. Check: docker compose logs api"
      exit 1
    fi
  done
  docker compose exec -T api python -c "
from app.db.session import engine
from app.db.base import Base
import app.models  # noqa: F401
Base.metadata.create_all(bind=engine)
print('DB tables ready')
" 2>/dev/null || true
  docker compose exec -T \
    -e "TEST_PHONE_NUMBERS=[\"${DEMO_PHONE}\"]" \
    -e TEST_OTP_CODE=424242 \
    api python -m scripts.seed_test_phones || true
  cd "${REPO_ROOT}"
else
  echo "[demo] SKIP_DOCKER=1 — using API at ${API_URL}"
fi

echo ""
echo "▶ Running API performance script…"
cd "${BACKEND}"
if [[ "${SKIP_DOCKER:-0}" != "1" ]]; then
  docker compose exec -T \
    -e DEMO_API_URL="http://localhost:8000" \
    -e DEMO_PHONE="${DEMO_PHONE}" \
    -e "TEST_PHONE_NUMBERS=[\"${DEMO_PHONE}\"]" \
    -e TEST_OTP_CODE=424242 \
    api python -m scripts.demo_receipt_perf
else
  DEMO_API_URL="${API_URL}" DEMO_PHONE="${DEMO_PHONE}" python -m scripts.demo_receipt_perf
fi
DEMO_EXIT=$?

pull_demo_artifacts_from_api_container() {
  [[ "${SKIP_DOCKER:-0}" == "1" ]] && return 0
  local cid token_dest receipt_dest
  cid="$(docker compose -f "${BACKEND}/docker-compose.yml" ps -q api 2>/dev/null | head -1)"
  [[ -z "${cid}" ]] && return 0
  token_dest="${SETLD_DEMO_TOKEN_FILE:-/tmp/settld_demo_token.txt}"
  receipt_dest="${BACKEND}/scripts/fixtures/demo_receipt.jpg"
  mkdir -p "$(dirname "${receipt_dest}")"
  if docker cp "${cid}:/tmp/settld_demo_token.txt" "${token_dest}" 2>/dev/null; then
    echo "▶ JWT for app auto-login: ${token_dest}"
  fi
  if docker cp "${cid}:/app/scripts/fixtures/demo_receipt.jpg" "${receipt_dest}" 2>/dev/null; then
    echo "▶ Demo receipt image: ${receipt_dest}"
  fi
}
pull_demo_artifacts_from_api_container

cd "${REPO_ROOT}"

BILL_ID_FILE="${SETTLD_DEMO_BILL_FILE:-/tmp/settld_demo_bill_id}"
if [[ -f "${BILL_ID_FILE}" ]]; then
  DEMO_BILL_ID="$(cat "${BILL_ID_FILE}")"
  echo ""
  echo "▶ Demo bill ready: ${DEMO_BILL_ID}"
fi

if [[ "${SKIP_EXPO:-0}" == "1" ]]; then
  echo ""
  echo "SKIP_EXPO=1 — done (API demo only)."
  exit "${DEMO_EXIT}"
fi

echo ""
echo "▶ Preparing demo receipt image…"
if [[ "${SKIP_DOCKER:-0}" != "1" ]]; then
  docker compose -f "${BACKEND}/docker-compose.yml" exec -T api \
    python -m scripts.demo_receipt_perf --generate-image-only 2>/dev/null || true
else
  (cd "${BACKEND}" && python3 -m scripts.demo_receipt_perf --generate-image-only) 2>/dev/null || true
fi

RECEIPT_IMG="${BACKEND}/scripts/fixtures/demo_receipt.jpg"
RN_RECEIPT_ASSET="${RN_APP}/assets/demo-receipt.jpg"
mkdir -p "${RN_APP}/assets"
if [[ -f "${RECEIPT_IMG}" ]]; then
  cp "${RECEIPT_IMG}" "${RN_RECEIPT_ASSET}"
  echo "▶ Bundled demo receipt → frontend/ReactNativeApp/assets/demo-receipt.jpg"
fi

echo "▶ Booting iOS Simulator…"
boot_demo_simulator || echo "   (Will retry when Expo opens the simulator)"

TOKEN_FILE="${SETLD_DEMO_TOKEN_FILE:-/tmp/settld_demo_token.txt}"
if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "✗ Missing ${TOKEN_FILE} (API demo should write JWT). Re-run without SKIP_EXPO."
  exit 1
fi
DEMO_TOKEN="$(tr -d '\n' < "${TOKEN_FILE}")"

if ! try_start_sim_recording; then
  echo "▶ Screen recording will start once the simulator is detected…"
fi

echo ""
echo "▶ Automated UI demo (no login / taps required)…"
echo "   EXPO_PUBLIC_API_URL=${API_URL}"
echo "   EXPO_PUBLIC_ASYNC_RECEIPT_PARSE=1"
echo "   EXPO_PUBLIC_DEMO_AUTO_RUN=1"
echo ""

cd "${RN_APP}"
if [[ ! -d node_modules ]]; then
  npm install
fi

export EXPO_PUBLIC_API_URL="${API_URL}"
export EXPO_PUBLIC_ASYNC_RECEIPT_PARSE=1
export EXPO_PUBLIC_DEMO_AUTO_RUN=1
export EXPO_PUBLIC_DEMO_AUTO_TOKEN="${DEMO_TOKEN}"

rm -f "${EXPO_LOG}"
# Metro + simulator; log file is polled for completion marker.
npx expo start --ios >>"${EXPO_LOG}" 2>&1 &
EXPO_PID=$!

echo "▶ Waiting for app to finish demo (grep DEMO_PERF_UI_COMPLETE)…"
UI_OK=0
RECORD_OK=0
for _ in $(seq 1 "${MAX_UI_WAIT_SEC}"); do
  try_start_sim_recording && RECORD_OK=1
  if [[ -f "${EXPO_LOG}" ]] && grep -q 'DEMO_PERF_UI_COMPLETE' "${EXPO_LOG}"; then
    UI_OK=1
    echo "   UI demo finished."
    sleep 3
    break
  fi
  if [[ -f "${EXPO_LOG}" ]] && grep -q 'DEMO_PERF_UI_FAILED' "${EXPO_LOG}"; then
    echo "✗ UI demo failed — see ${EXPO_LOG}"
    break
  fi
  if ! kill -0 "${EXPO_PID}" 2>/dev/null; then
    echo "✗ Expo exited early — see ${EXPO_LOG}"
    break
  fi
  sleep 1
done

if [[ "${UI_OK}" -eq 0 ]]; then
  echo "✗ Timed out after ${MAX_UI_WAIT_SEC}s waiting for UI demo."
fi
if [[ "${SKIP_RECORD:-0}" != "1" && "${RECORD_OK}" -eq 0 ]]; then
  echo "✗ Screen recording never started — was the Simulator booted?"
fi

echo "▶ Stopping Expo…"
kill -INT "${EXPO_PID}" 2>/dev/null || true
sleep 2
kill -TERM "${EXPO_PID}" 2>/dev/null || true
wait "${EXPO_PID}" 2>/dev/null || true
pkill -f "expo start.*ReactNativeApp" 2>/dev/null || true
pkill -f "@expo/cli.*start" 2>/dev/null || true

stop_sim_recording

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Done."
if [[ -n "${RECORD_FILE}" && -f "${RECORD_FILE}" ]]; then
  echo "  Video: ${RECORD_FILE}"
fi
echo "  API benchmark: see output above (enqueue_ms vs sync_total_ms)"
echo "═══════════════════════════════════════════════════════════"

RECORD_FAIL=0
if [[ "${SKIP_RECORD:-0}" != "1" ]]; then
  if [[ -z "${RECORD_FILE}" || ! -f "${RECORD_FILE}" ]]; then
    RECORD_FAIL=1
  fi
fi

exit $(( DEMO_EXIT + (1 - UI_OK) + RECORD_FAIL ))
