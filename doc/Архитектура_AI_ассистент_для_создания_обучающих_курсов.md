# Архитектура EcoLMS

**Версия:** 2026-04-28

Документ описывает текущую архитектуру репозитория и отмечает, что уже реализовано в коде.

## Цель системы

EcoLMS собирает учебные материалы из файлов заказчика и поэтапно формирует:

- `source_compiled`
- `course_outline`
- `course_content`
- `course_test`

Основной сценарий остаётся таким:

1. создать проект;
2. загрузить исходные файлы;
3. запустить обработку;
4. получить и отредактировать результаты этапов;
5. скачать готовые артефакты.

Дополнительно в проекте согласован отдельный модуль `meetings` для анализа записей встреч. Он не смешивается с модулем курсов и использует собственные сущности, API и UI при переиспользовании общей инфраструктуры. Подробности вынесены в [Модуль_встреч.md](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/doc/Модуль_встреч.md).

## Реальная схема сервисов

```text
web (Next.js)
  -> api (NestJS, /api)
     -> PostgreSQL
     -> Redis
     -> S3-compatible storage
     -> transcription-service (HTTP)
worker (Python)
  -> Redis
  -> PostgreSQL
  -> S3-compatible storage
  -> transcription-service
  -> OpenAI / OpenRouter
```

Для модуля `meetings` поверх этой схемы добавляется ещё один внешний ML-провайдер:

```text
worker (Python)
  -> SaluteSpeech
```

При этом `SaluteSpeech` рассматривается как единственный целевой провайдер V1 для русского diarized transcript, а `transcription-service` остаётся в проекте для существующего курса-ориентированного pipeline.

## Сервисы и ответственность

### `web`

- UI на Next.js App Router;
- использует только локальный BFF-style proxy для backend-запросов;
- содержит клиент работы с API и экран управления проектами;
- не выполняет тяжёлую обработку файлов.

### `api`

- NestJS-приложение с глобальным префиксом `/api`;
- управляет проектами, файлами, upload-сессиями, задачами и артефактами;
- создаёт минимальную схему PostgreSQL при старте;
- отправляет задания в Redis list `ecolms:processing-jobs`;
- собирает сводку health-check по зависимостям.

Важно: текущая очередь реализована не через BullMQ, а через собственную работу с Redis protocol over TCP.

### `worker`

- отдельный Python-процесс;
- читает задания из Redis;
- скачивает файлы из S3-compatible storage;
- извлекает текст из документов;
- вызывает `transcription-service` для аудио и видео;
- вызывает OpenAI/OpenRouter;
- сохраняет результат этапа в PostgreSQL.

### `transcription-service`

- отдельный Python HTTP service без FastAPI;
- принимает source из S3, URL или локального пути;
- приводит медиа к `wav 16kHz mono`;
- запускает `faster-whisper`;
- возвращает текст и сегменты.

## Текущий стек

### Frontend

- Next.js `16.2.2`
- React `19.2.4`
- TypeScript `5`
- Tailwind CSS `4`
- shadcn/ui

### Backend

- NestJS `11`
- `pg`
- `@nestjs/config`
- `class-validator`

### Worker и transcription

- Python
- `psycopg`
- `boto3`
- `faster-whisper`
- `pypdf`
- `python-docx`
- `python-pptx`
- `striprtf`
- `ffmpeg`

## Поток загрузки

1. `web` создаёт проект через `POST /api/projects`.
2. `api` создаёт `upload_session` и запись в `source_files`.
3. `api` выдаёт signed URL для частей файла.
4. `web` загружает части напрямую в S3 через proxy-route `PUT`.
5. `api` завершает multipart upload и обновляет статус файла.

## Поток обработки

1. Пользователь запускает проект или отдельный этап.
2. `api` создаёт запись в `processing_jobs`.
3. `api` кладёт JSON-сообщение в Redis.
4. `worker` забирает задачу из очереди.
5. В зависимости от типа файла worker:
   извлекает текст напрямую или обращается к `transcription-service`.
6. Worker при необходимости вызывает OpenAI/OpenRouter.
7. Результаты сохраняются как `md` и `json` в таблицу `artifacts`.
8. `web` читает обновлённое состояние проекта и показывает его пользователю.

## Ограничения текущей реализации

- аутентификации нет;
- публичного endpoint подтверждения этапа пока нет, хотя данные для `stage_reviews` уже предусмотрены;
- PostgreSQL используется и как хранилище артефактов, хотя часть старых документов предполагала хранение только в S3;
- worker и API используют собственную низкоуровневую интеграцию с Redis вместо готовой очереди;
- `build` на корне собирает только `web` и `api`, Python-сервисы запускаются отдельно.
