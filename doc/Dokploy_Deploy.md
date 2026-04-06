# Dokploy Deploy

Это минимальная инструкция для поднятия EcoLMS на Dokploy.

## Сервисы

- `web` - Next.js frontend
- `api` - NestJS API
- `worker` - фоновый воркер, который читает Redis-очередь и обновляет PostgreSQL
- `transcription-service` - локальный сервис транскрибации

## Файлы деплоя

- [docker/web.Dockerfile](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/docker/web.Dockerfile)
- [docker/api.Dockerfile](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/docker/api.Dockerfile)
- [docker/worker.Dockerfile](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/docker/worker.Dockerfile)
- [docker/transcription-service.Dockerfile](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/docker/transcription-service.Dockerfile)
- [docker-compose.dokploy.yml](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/docker-compose.dokploy.yml)

## Порты

- `web`: `3000`
- `api`: `3001`
- `transcription-service`: `3002`
- `worker`: без внешнего порта

## Окружение

### `web`

- `PORT=3000`
- `HOSTNAME=0.0.0.0`
- `NEXT_PUBLIC_API_BASE_URL=http://api:3001`

### `api`

- `API_PORT=3001`
- `POSTGRES_URL`
- `REDIS_URL`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `TRANSCRIPTION_SERVICE_URL=http://transcription-service:3002`

### `worker`

- `API_BASE_URL=http://api:3001`
- `POSTGRES_URL`
- `REDIS_URL`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `TRANSCRIPTION_SERVICE_URL=http://transcription-service:3002`

### `transcription-service`

- `TRANSCRIPTION_PORT=3002`

## Как поднимать в Dokploy

1. Создать новый Docker Compose проект.
2. Указать файл [docker-compose.dokploy.yml](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/docker-compose.dokploy.yml).
3. Подставить секреты для `POSTGRES_URL`, `REDIS_URL`, `S3_*`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`.
4. Развернуть stack.
5. Проверить healthchecks:
   - `web` на `/`
   - `api` на `/api/health`
   - `transcription-service` на `/health`

## Что нужно помнить

- `api` уже использует PostgreSQL как постоянное хранилище, поэтому контейнерный рестарт не теряет проекты и файлы.
- `web` и `worker` уже готовы к контейнерному старту.
- `transcription-service` сейчас является заглушкой, но контейнер стартует и отвечает на healthcheck.
