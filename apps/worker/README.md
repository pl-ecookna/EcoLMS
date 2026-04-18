# Worker service

Сервис фоновой обработки EcoLMS на Python.

## Что делает сейчас

- читает задачи из Redis-очереди `ecolms:processing-jobs`;
- читает задачи модуля `meetings` из Redis-очереди `ecolms:meeting-jobs`;
- загружает исходники из S3-compatible storage;
- извлекает текст из `pdf`, `docx`, `pptx`, `rtf` и текстовых файлов;
- отправляет аудио и видео в `transcription-service`;
- подготавливает аудио встреч через `ffmpeg/ffprobe`;
- отправляет подготовленный звук в `SaluteSpeech` и нормализует diarized transcript;
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
- для модуля `meetings`: `WORKER_MEETING_JOB_QUEUE_KEY` и `SALUTESPEECH_*`

Для обработки встреч в окружении также должен быть доступен `ffmpeg`.
Рекомендуемый путь для Sber TLS: `SALUTESPEECH_CA_CERT_PATH=certs/russiantrustedca.pem`.
Для dev-среды при проблемах с TLS-цепочкой можно временно включить `SALUTESPEECH_SSL_NO_VERIFY=true`.
Для LLM-вызовов (`OpenAI`/`OpenRouter`) worker использует trust store из `certifi`.
Prompt templates для `lms` и `meetings` worker читает из таблицы `llm_prompts` в PostgreSQL.
Если запись в таблице отсутствует, worker дозаписывает дефолтный prompt из кода и использует его как seed.

Текущий формат подготовки аудио для `SaluteSpeech` в V1:

- `OPUS`, `48kHz`, `mono`;
- контейнер `ogg` (`audio_encoding=OPUS` в запросе).

## Ключевой файл

- [apps/worker/src/worker/main.py](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/worker/src/worker/main.py)
