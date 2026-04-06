# EcoLMS

EcoLMS — внутренний веб-инструмент для подготовки обучающих курсов по материалам заказчика: видео, презентациям и документам.

## Что делает продукт

- принимает до 5 файлов в одном проекте;
- загружает большие файлы напрямую в S3-compatible storage Beget через multipart upload;
- извлекает текст из видео, PDF, PPT/PPTX, DOC/DOCX;
- очищает и нормализует материал;
- формирует поэтапный результат:
  - `source_compiled`
  - `course_outline`
  - `course_content`
  - `course_test`
- позволяет вручную редактировать Markdown на каждом этапе;
- хранит итоговые артефакты только в S3;
- показывает статусы обработки в интерфейсе.

## Зафиксированные решения MVP

- приложение внутреннее, без аутентификации;
- один сервер, один проект в Dokploy;
- внешние сервисы остаются отдельными:
  - PostgreSQL;
  - Redis;
  - Beget S3;
- LLM для MVP:
  - OpenAI;
  - OpenRouter;
- транскрибация выполняется локальным Whisper-сервисом;
- фоновая обработка идёт через Redis-очередь и worker;
- upload resume после закрытия вкладки не нужен;
- в одном проекте можно смешивать видео и документы;
- редактор результатов — обычный Markdown-редактор;
- подтверждение этапа делается на том же экране, где редактируется результат;
- каноническая модель статусов job: `queued`, `processing`, `done`, `failed`.
- имя проекта берется из GitHub-источника и не задается вручную в MVP;
- хранится только последняя версия отредактированного этапа;
- очистка S3-артефактов выполняется раз в неделю и касается только проектов, где уже собран полный пакет.

## Рекомендуемый стек

- Frontend: Next.js, React, TypeScript, shadcn/ui;
- Backend API: NestJS, TypeScript, PostgreSQL-backed persistence;
- Worker: Python;
- Transcription service: Python + `openai/whisper`;
- Queue: Redis + BullMQ;
- Storage: Beget S3-compatible storage;
- Database: PostgreSQL.

## Временные параметры разработки

Подключения для текущего этапа разработки сохранены в [doc/Сервисы.md](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/doc/Сервисы.md).

## Развертывание

Для Dokploy подготовлен отдельный compose-stack и Dockerfile на каждый сервис:

- [doc/Dokploy_Deploy.md](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/doc/Dokploy_Deploy.md)
- [docker-compose.dokploy.yml](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/docker-compose.dokploy.yml)
- [docker/web.Dockerfile](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/docker/web.Dockerfile)
- [docker/api.Dockerfile](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/docker/api.Dockerfile)
- [docker/worker.Dockerfile](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/docker/worker.Dockerfile)
- [docker/transcription-service.Dockerfile](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/docker/transcription-service.Dockerfile)

## Как запускать локально

1. Скопировать `.env.example` в `.env` и подставить свои значения.
2. Установить зависимости в workspace: `pnpm install`.
3. Запустить фронтенд: `pnpm dev`.
4. Запустить API: `pnpm dev:api`.
5. Запустить transcription service: `pnpm dev:transcription`.
6. Worker пока запускается как заглушка: `pnpm dev:worker`.
7. Для контейнерного запуска можно использовать `pnpm docker:up`.

### Важная деталь для `web`

Фронтенд ходит в backend через локальный proxy-route `apps/web/src/app/api/[...path]/route.ts`.
Для него нужно задать `ECOLMS_API_BASE_URL`:

- локально: `http://localhost:3001`;
- в Dokploy: `http://api:3001`.

Наружу публикуется только `web`. `api`, `worker` и `transcription-service`
должны жить только во внутренней Docker-сети и не требуют отдельных
публичных доменов.

## Пайплайн

1. Пользователь создаёт проект.
2. Загружает файлы напрямую в S3.
3. Подтверждает запуск обработки.
4. Worker скачивает исходники и обрабатывает их.
5. Система формирует `source_compiled`.
6. Пользователь редактирует и подтверждает результат.
7. Система последовательно генерирует план, материалы и тест.
8. Пользователь редактирует и подтверждает каждый этап.
9. Итоговые Markdown и JSON остаются в S3 и доступны для скачивания.

## Объекты проекта

- `projects` — карточки проектов и их состояние;
- `source_files` — исходные файлы;
- `upload_sessions` — multipart upload;
- `processing_jobs` — фоновые задачи;
- `artifacts` — ссылки на итоговые и промежуточные файлы в S3;
- `stage_reviews` — факт ручного подтверждения этапа.

## Статусы

### Job statuses

- `queued`
- `processing`
- `done`
- `failed`

### Project statuses

- `draft`
- `uploaded`
- `processing`
- `awaiting_review`
- `completed`
- `failed`

## Параметры по умолчанию

- до 25 проектов на странице списка;
- до 2 ГБ на файл;
- до 5 файлов в проекте;
- целевой язык материалов: русский;
- аудио для Whisper: 16 kHz, mono, WAV/PCM 16-bit.

## Что ещё нужно согласовать

- точную JSON-схему каждого этапа;
- текст пользовательских сообщений об ошибках;
- финальный вид страниц и навигации.
