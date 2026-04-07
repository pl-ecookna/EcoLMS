# Локальная UI-отладка

Быстрый режим для проверки интерфейса без `worker` и `transcription-service`.

## Запуск

```bash
cd /Users/romangaleev/CodeProject/Ecookna/EcoLMS
pnpm dev:ui
```

Откройте: `http://localhost:3000`

## Что поднимается

- `api` на `3101`
- `web` на `3000`

`Postgres` и `Redis` берутся из ваших текущих переменных окружения (например, боевые, если они доступны).

## Остановка

Нажмите `Ctrl+C` в терминале с `pnpm dev:ui` — скрипт завершит оба процесса.

## Переопределение портов

```bash
API_PORT=3201 WEB_PORT=3006 ECOLMS_API_BASE_URL=http://localhost:3201 pnpm dev:ui
```
