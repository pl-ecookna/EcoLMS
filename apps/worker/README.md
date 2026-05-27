# Worker service

Сервис фоновой обработки EcoLMS на Python.

## Что делает сейчас

- читает задачи из Redis-очереди `ecolms:processing-jobs`;
- читает задачи модуля `meetings` из Redis-очереди `ecolms:meeting-jobs`;
- загружает исходники из S3-compatible storage;
- извлекает текст из `pdf`, `docx`, `pptx`, `rtf` и текстовых файлов;
- отправляет аудио и видео в `transcription-service`;
- подготавливает аудио встреч через `ffmpeg/ffprobe`;
- отправляет подготовленный звук в `AssemblyAI` или `SaluteSpeech` и нормализует diarized transcript;
- готовит markdown для этапов `source_compiled`, `course_outline`, `course_content`, `course_test`;
- генерирует `meeting_summary`, `meeting_protocol`, `meeting_actions`;
- вызывает OpenAI или OpenRouter для анализа и генерации;
- сохраняет результаты и статусы в PostgreSQL.

## Основные зависимости

- `psycopg`
- `boto3`
- `pypdf`
- `python-docx`
- `python-pptx`
- `striprtf`
- `ffmpeg`
- `ffprobe`

## Локальный запуск

Для локального запуска `worker` в репозитории используется `uv`, чтобы не зависеть от системного Python и вручную установленных пакетов:

- команда запуска из корня репозитория: `pnpm dev:worker`
- напрямую: `uv run --project apps/worker ecolms-worker`

Перед запуском должны быть заданы переменные окружения:

- `POSTGRES_URL`
- `REDIS_URL`
- `S3_*`
- `LLM_PRIMARY_PROVIDER` и набор переменных только для выбранного провайдера: `OPENAI_*` или `OPENROUTER_*`
- для модуля `meetings`: `WORKER_MEETING_JOB_QUEUE_KEY`, `MEETING_TRANSCRIPTION_PROVIDER` и переменные выбранного STT-провайдера

Для обработки встреч в окружении также должен быть доступен `ffmpeg`.
Для `SaluteSpeech` рекомендуемый путь для Sber TLS: `SALUTESPEECH_CA_CERT_PATH=certs/russiantrustedca.pem`.
Для dev-среды при проблемах с TLS-цепочкой можно временно включить `SALUTESPEECH_SSL_NO_VERIFY=true`.
Для `AssemblyAI` по умолчанию используется `ASSEMBLYAI_BASE_URL=https://api.eu.assemblyai.com` и доступ к файлу через временный `S3 presigned URL`. Для `meetings` worker передаёт в `AssemblyAI` исходный `source file` по URL и не скачивает гигантский видеофайл локально.
Если подготовка аудио зависает на большом файле, увеличь `MEETING_AUDIO_PREP_TIMEOUT_SECONDS`.
Для защиты от зависших встреч используется `MEETING_JOB_STALE_TIMEOUT_SECONDS` на стороне API: если job слишком долго остаётся в `queued` или `processing`, она автоматически переводится в `failed`.
Для LLM-вызовов (`OpenAI`/`OpenRouter`) worker использует trust store из `certifi`.
Prompt templates для `lms` и `meetings` worker читает из таблицы `llm_prompts` в PostgreSQL.
Если запись в таблице отсутствует, worker дозаписывает дефолтный prompt из кода и использует его как seed.
Для `meeting_actions` worker умеет восстанавливать человекочитаемый markdown из полей
`decisions`, `actionItems` и `openQuestions`, если LLM вернул валидный JSON, но оставил
поле `markdown` пустым.

Повторный запуск meeting job со стадией `retry` продолжает пайплайн дальше по цепочке
`transcript_compiled -> meeting_summary -> meeting_protocol -> meeting_actions`, чтобы
после пересборки транскрипта downstream-артефакты не оставались на seed-заготовках.

Текущий формат подготовки аудио остаётся совместимым с `SaluteSpeech` и `AssemblyAI`:

- `OPUS`, `48kHz`, `mono`;
- контейнер `ogg` (`audio_encoding=OPUS` в запросе для `SaluteSpeech`).

Для `meetings` worker скачивает исходник потоково в temp-file, чтобы не держать гигантский `webm` целиком в памяти; если исходник уже содержит `opus`-аудио, worker старается сделать быстрый `remux` без перекодирования. При долгих шагах heartbeat обновляется периодически, чтобы job не выглядела зависшей.

## Ключевой файл

- [apps/worker/src/worker/main.py](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/worker/src/worker/main.py)
