# Worker service

Сервис фоновой обработки EcoLMS на Python.

## Что делает сейчас

- читает задачи из Redis-очереди `ecolms:processing-jobs`;
- загружает исходники из S3-compatible storage;
- извлекает текст из `pdf`, `docx`, `pptx`, `rtf` и текстовых файлов;
- отправляет аудио и видео в `transcription-service`;
- готовит markdown для этапов `source_compiled`, `course_outline`, `course_content`, `course_test`;
- вызывает OpenAI или OpenRouter для анализа и генерации;
- сохраняет результаты и статусы в PostgreSQL.

## Основные зависимости

- `psycopg`
- `boto3`
- `pypdf`
- `python-docx`
- `python-pptx`
- `striprtf`

## Ключевой файл

- [apps/worker/src/worker/main.py](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/worker/src/worker/main.py)
