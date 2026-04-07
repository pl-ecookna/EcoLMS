#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

API_PORT="${API_PORT:-3101}"
WEB_PORT="${WEB_PORT:-3000}"
ECOLMS_API_BASE_URL="${ECOLMS_API_BASE_URL:-http://localhost:${API_PORT}}"

cd "$ROOT_DIR"

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

free_port() {
  PORT="$1"

  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

  if ! port_in_use "${PORT}"; then
    return 0
  fi

  PIDS="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN || true)"
  if [ -z "${PIDS}" ]; then
    return 0
  fi

  echo "[dev:ui] freeing port ${PORT} (pids: ${PIDS})"
  kill ${PIDS} 2>/dev/null || true
  sleep 1

  if port_in_use "${PORT}"; then
    PIDS="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN || true)"
    if [ -n "${PIDS}" ]; then
      echo "[dev:ui] force killing port ${PORT} listeners"
      kill -9 ${PIDS} 2>/dev/null || true
      sleep 1
    fi
  fi
}

free_port "${API_PORT}"
free_port "${WEB_PORT}"

echo "[dev:ui] starting API on :${API_PORT}"
API_PORT="${API_PORT}" pnpm --dir apps/api dev &
API_PID=$!

echo "[dev:ui] building WEB before start..."
pnpm --dir apps/web build

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

API_EXIT=0
WEB_EXIT=0

set +e
if ! kill -0 "${API_PID}" 2>/dev/null; then
  wait "${API_PID}"
  API_EXIT=$?
fi

if ! kill -0 "${WEB_PID}" 2>/dev/null; then
  wait "${WEB_PID}"
  WEB_EXIT=$?
fi
set -e

echo "[dev:ui] one of processes exited (api=${API_EXIT}, web=${WEB_EXIT})"
exit 1
