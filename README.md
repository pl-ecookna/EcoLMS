# EcoLMS

EcoLMS — внутренняя платформа для работы с контентом из медиа- и документных источников. Сейчас в репозитории уже реализован workflow генерации обучающих курсов, а для `meetings` добавлены backend API, схема БД, worker pipeline под `SaluteSpeech` и UI-раздел `/meetings`. Репозиторий организован как `pnpm`-монорепозиторий с четырьмя приложениями: `web`, `api`, `worker` и `transcription-service`.

## Актуальный стек

- Workspace: `pnpm@10.12.4`
- Frontend: Next.js `16.2.2`, React `19.2.4`, TypeScript `5`, Tailwind CSS `4`, shadcn/ui, `react-markdown`
- Backend API: NestJS `11`, TypeScript, `pg` без ORM, `class-validator`, `class-transformer`
- Worker: Python, `psycopg`, `boto3`, `pypdf`, `python-docx`, `python-pptx`, `striprtf`
- Transcription service: Python `http.server`, `faster-whisper`, `boto3`, `ffmpeg`
- Infrastructure: PostgreSQL `16`, Redis `7`, S3-compatible storage
- LLM providers: OpenAI и OpenRouter

## Структура репозитория

- `apps/web` — UI на Next.js с App Router, включая `courses` и `meetings`
- `apps/api` — NestJS API для `courses`, `meetings`, загрузок, задач, артефактов и health-check
- `apps/worker` — фоновая обработка файлов, генерация этапов курса и pipeline модуля `meetings`
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
- отдельный экран `/meetings` в двухпанельной компоновке: список встреч слева, результаты обработки справа;
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
- [doc/Модуль_встреч.md](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/doc/Модуль_встреч.md)

## Зафиксированное развитие

Для нового модуля `meetings` уже зафиксированы и частично реализованы такие решения:

- отдельный bounded context, не смешанный с workflow курсов;
- язык встреч в V1: только русский;
- один файл на встречу;
- целевой провайдер распознавания и диаризации: `SaluteSpeech`;
- канонический результат хранится в PostgreSQL, а сырой ответ провайдера сохраняется в `job result_json`;
- ручная правка speaker labels предусмотрена в UI и модели данных;
- UI-раздел `/meetings` уже добавлен и показывает список встреч, карточку встречи и единый markdown-файл.

Что уже есть в backend:

- таблицы `meetings`, `meeting_source_files`, `meeting_upload_sessions`, `meeting_jobs`, `meeting_speakers`, `meeting_speaker_segments`, `meeting_artifacts`;
- REST-маршруты `/api/meetings/*`;
- отдельная Redis-очередь `ecolms:meeting-jobs`;
- worker pipeline `audio_prepared -> transcript_compiled -> meeting_summary -> meeting_protocol -> meeting_actions`;
- интеграция worker с `SaluteSpeech` через async API и нормализацию diarized transcript в PostgreSQL.

## Локальный запуск

1. Создать `.env` на основе `.env.example`.
2. Установить зависимости: `pnpm install`.
3. Поднять локальные `Postgres + Redis`: `pnpm dev:infra:up`.
4. Запустить API: `pnpm dev:api`.
5. Запустить web: `pnpm dev:web`.
6. При необходимости запустить transcription service: `pnpm dev:transcription`.
7. При необходимости запустить worker: `pnpm dev:worker`.

Примечание: `pnpm dev:worker` использует `uv` и зависимости из [apps/worker/pyproject.toml](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/worker/pyproject.toml), а для обработки встреч `meetings` worker требует доступный `ffmpeg`.

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
- `LLM_TIMEOUT_SECONDS`
- `TRANSCRIPTION_SERVICE_URL`
- `WHISPER_MODEL_SIZE`
- `WHISPER_COMPUTE_TYPE`
- `WORKER_JOB_QUEUE_KEY`
- `WORKER_MEETING_JOB_QUEUE_KEY`
- `SALUTESPEECH_AUTH_KEY`
- `SALUTESPEECH_OAUTH_URL`
- `SALUTESPEECH_REST_URL`
- `SALUTESPEECH_UPLOAD_URL`
- `SALUTESPEECH_RECOGNIZE_URL`
- `SALUTESPEECH_TASK_URL`
- `SALUTESPEECH_DOWNLOAD_URL`
- `SALUTESPEECH_SCOPE`
- `SALUTESPEECH_MODEL`
- `SALUTESPEECH_LANGUAGE`
- `SALUTESPEECH_CA_CERT_PATH`
- `SALUTESPEECH_SSL_NO_VERIFY`
- `SALUTESPEECH_POLL_INTERVAL_SECONDS`
- `SALUTESPEECH_TIMEOUT_SECONDS`

Полный пример находится в [.env.example](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/.env.example).
