#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

API_PORT="${API_PORT:-3101}"
WEB_PORT="${WEB_PORT:-3000}"
ECOLMS_API_BASE_URL="${ECOLMS_API_BASE_URL:-http://localhost:${API_PORT}}"

cd "$ROOT_DIR"

echo "[dev:ui] starting API on :${API_PORT}"
API_PORT="${API_PORT}" pnpm --dir apps/api dev &
API_PID=$!

echo "[dev:ui] starting WEB on :${WEB_PORT} (API=${ECOLMS_API_BASE_URL})"
PORT="${WEB_PORT}" ECOLMS_API_BASE_URL="${ECOLMS_API_BASE_URL}" pnpm --dir apps/web start &
WEB_PID=$!

cleanup() {
  echo "[dev:ui] stopping processes..."
  kill "${API_PID}" "${WEB_PID}" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

while kill -0 "${API_PID}" 2>/dev/null && kill -0 "${WEB_PID}" 2>/dev/null; do
  sleep 1
done

echo "[dev:ui] one of processes exited"
