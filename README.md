# EcoLMS

EcoLMS — внутренний инструмент для сборки обучающих курсов из видео, аудио и документов. Репозиторий организован как `pnpm`-монорепозиторий с четырьмя приложениями: `web`, `api`, `worker` и `transcription-service`.

## Актуальный стек

- Workspace: `pnpm@10.12.4`
- Frontend: Next.js `16.2.2`, React `19.2.4`, TypeScript `5`, Tailwind CSS `4`, shadcn/ui, `react-markdown`
- Backend API: NestJS `11`, TypeScript, `pg` без ORM, `class-validator`, `class-transformer`
- Worker: Python, `psycopg`, `boto3`, `pypdf`, `python-docx`, `python-pptx`, `striprtf`
- Transcription service: Python `http.server`, `faster-whisper`, `boto3`, `ffmpeg`
- Infrastructure: PostgreSQL `16`, Redis `7`, S3-compatible storage
- LLM providers: OpenAI и OpenRouter

## Структура репозитория

- `apps/web` — UI на Next.js с App Router
- `apps/api` — NestJS API для проектов, загрузок, задач, артефактов и health-check
- `apps/worker` — фоновая обработка файлов и генерация этапов курса
- `apps/transcription-service` — сервис транскрибации аудио и видео
- `doc` — предметная и инфраструктурная документация
- `docker` — Dockerfile для каждого сервиса

## Текущая архитектура

```text
Browser
  -> web (Next.js)
  -> api (NestJS, /api/*)
  -> PostgreSQL
  -> Redis
  -> S3-compatible storage
  -> worker (Python)
  -> transcription-service (Python + faster-whisper)
```

### Как это работает сейчас

1. Пользователь создаёт проект через `web`.
2. `api` создаёт запись проекта и артефакты-заготовки для этапов:
   `source_compiled`, `course_outline`, `course_content`, `course_test`.
3. Для загрузки файлов `api` выдаёт параметры multipart upload и signed URL для частей.
4. Файлы уходят напрямую в S3-compatible storage.
5. `api` ставит задачу в Redis-очередь `ecolms:processing-jobs`.
6. `worker` читает задачу, скачивает файлы, извлекает текст или транскрибирует аудио/видео, затем вызывает OpenAI/OpenRouter.
7. Результаты этапов сохраняются в PostgreSQL как артефакты `md` и `json`.
8. `web` показывает статус проекта, историю задач и позволяет редактировать Markdown-артефакты.

## Реализованные приложения

### `apps/web`

- один экран-дашборд для списка проектов и карточки проекта;
- загрузка до 5 файлов;
- поддержка документов, аудио и видео;
- запуск генерации отдельных этапов и цепочки этапов;
- просмотр и редактирование Markdown-артефактов;
- proxy-route для запросов к backend: [apps/web/src/app/api/[...path]/route.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/web/src/app/api/[...path]/route.ts);
- proxy-route для `PUT` загрузки в S3 по signed URL: [apps/web/src/app/api/s3-upload/route.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/web/src/app/api/s3-upload/route.ts).

### `apps/api`

- глобальный префикс маршрутов: `/api`;
- контроллеры: `projects`, `uploads`, `jobs`, `artifacts`, `health`;
- хранение и миграция минимальной схемы БД выполняются прямо из `PostgresService`;
- очередь реализована через Redis list, без BullMQ;
- presigned URL для S3 формируются собственным кодом, без AWS SDK.

### `apps/worker`

- обработка очереди из Redis;
- скачивание исходников из S3;
- извлечение текста из `pdf`, `docx`, `pptx`, `rtf`, `txt`;
- вызов transcription-service для аудио/видео;
- генерация `source_compiled`, `course_outline`, `course_content`, `course_test`;
- вызов OpenAI/OpenRouter по HTTP с fallback между провайдерами.

### `apps/transcription-service`

- HTTP API на встроенном `HTTPServer`;
- endpoint `GET /health`;
- endpoint `POST /transcribe`;
- загрузка источника из S3, URL или локального пути;
- нормализация аудио через `ffmpeg` в `16kHz mono wav`;
- транскрибация через `faster-whisper`.

## API и данные

Актуальные маршруты и схема данных описаны в:

- [doc/API_описание.md](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/doc/API_описание.md)
- [doc/DB_схема.md](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/doc/DB_схема.md)
- [doc/Архитектура_AI_ассистент_для_создания_обучающих_курсов.md](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/doc/Архитектура_AI_ассистент_для_создания_обучающих_курсов.md)

## Локальный запуск

1. Создать `.env` на основе `.env.example`.
2. Установить зависимости: `pnpm install`.
3. Поднять локальные `Postgres + Redis`: `pnpm dev:infra:up`.
4. Запустить API: `pnpm dev:api`.
5. Запустить web: `pnpm dev:web`.
6. При необходимости запустить transcription service: `pnpm dev:transcription`.
7. При необходимости запустить worker: `pnpm dev:worker`.

## Основные команды

- `pnpm dev` — web
- `pnpm dev:web` — web
- `pnpm dev:api` — api
- `pnpm dev:worker` — worker
- `pnpm dev:transcription` — transcription-service
- `pnpm build` — build `web` + `api`
- `pnpm lint` — lint `web`
- `pnpm docker:up` — поднять стек через Docker Compose
- `pnpm docker:down` — остановить стек

## Переменные окружения

Ключевые переменные:

- `ECOLMS_API_BASE_URL`
- `POSTGRES_URL`
- `REDIS_URL`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `LLM_PRIMARY_PROVIDER`
- `OPENAI_MODEL`
- `OPENROUTER_MODEL`
- `TRANSCRIPTION_SERVICE_URL`
- `WHISPER_MODEL_SIZE`
- `WHISPER_COMPUTE_TYPE`

Полный пример находится в [.env.example](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/.env.example).
