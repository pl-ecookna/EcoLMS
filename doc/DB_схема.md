# Схема базы данных (PostgreSQL)

Эта схема отражает минимальный набор сущностей для MVP.

---

## Таблица: projects

- id (uuid, PK)
- name (text)
- status (text)
- current_stage (text)
- created_at (timestamp)
- updated_at (timestamp)

## Таблица: source_files

- id (uuid, PK)
- project_id (uuid, FK)
- original_name (text)
- mime_type (text)
- size_bytes (bigint)
- storage_key (text)
- upload_status (text)
- processing_status (text)
- kind (text)
- position (int)
- created_at (timestamp)

## Таблица: upload_sessions

- id (uuid, PK)
- project_id (uuid, FK)
- source_file_id (uuid, FK)
- s3_upload_id (text)
- status (text)
- created_at (timestamp)
- completed_at (timestamp)

## Таблица: processing_jobs

- id (uuid, PK)
- project_id (uuid, FK)
- stage (text)
- status (text)
- payload_json (jsonb)
- result_json (jsonb)
- error_text (text)
- started_at (timestamp)
- finished_at (timestamp)
- created_at (timestamp)

## Таблица: artifacts

- id (uuid, PK)
- project_id (uuid, FK)
- stage (text)
- format (text)
- storage_key (text)
- created_at (timestamp)

## Таблица: stage_reviews

- id (uuid, PK)
- project_id (uuid, FK)
- stage (text)
- source_artifact_id (uuid, FK)
- edited_artifact_id (uuid, FK)
- approved_at (timestamp)

---

## Канонические статусы jobs

- queued
- processing
- done
- failed

---

## Канонические статусы проектов

- draft
- uploaded
- processing
- awaiting_review
- completed
- failed

---

## Замечания

- Таблица `users` не требуется для MVP, так как приложение внутреннее и работает без аутентификации.
- Большие итоговые данные не хранятся в PostgreSQL, в БД сохраняются только метаданные и ссылки на S3.
