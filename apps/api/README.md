# API service

Backend API EcoLMS на NestJS.

## Актуальный стек

- NestJS `11`
- TypeScript
- `pg` для прямой работы с PostgreSQL
- `@nestjs/config`
- `class-validator` / `class-transformer`

## Что делает сервис

- создаёт и обновляет проекты;
- хранит метаданные файлов, задач и артефактов;
- инициализирует multipart upload;
- выдаёт signed URL для частей upload;
- ставит задачи обработки в Redis;
- отдаёт health-сводку по API, PostgreSQL, Redis, LLM и transcription-service;
- возвращает итоговые ссылки для скачивания артефактов.

## Текущие контроллеры

- [apps/api/src/projects.controller.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/api/src/projects.controller.ts)
- [apps/api/src/uploads.controller.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/api/src/uploads.controller.ts)
- [apps/api/src/jobs.controller.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/api/src/jobs.controller.ts)
- [apps/api/src/artifacts.controller.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/api/src/artifacts.controller.ts)
- [apps/api/src/app.controller.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/api/src/app.controller.ts)

## Важные особенности реализации

- Все внешние маршруты доступны под префиксом `/api`.
- Минимальная схема БД создаётся внутри [apps/api/src/db/postgres.service.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/api/src/db/postgres.service.ts).
- Очередь обработки реализована через Redis list `ecolms:processing-jobs` в [apps/api/src/redis/redis.service.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/api/src/redis/redis.service.ts).
- Бизнес-логика собрана в [apps/api/src/store/ecolms.store.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/api/src/store/ecolms.store.ts).
- Логика подтверждения этапов уже есть в store, но отдельный публичный endpoint approve сейчас не опубликован контроллером.

## Запуск

- `pnpm dev`
- `pnpm build`
- `pnpm start`
