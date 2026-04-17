# Схема базы данных

Документ отражает текущую схему, которую сервис создаёт в [apps/api/src/db/postgres.service.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/api/src/db/postgres.service.ts).

## Таблица `projects`

- `id` `text`, PK
- `name` `text`
- `github_ref` `text`
- `source_summary` `text`
- `status` `text`
- `current_stage` `text`
- `progress` `integer`
- `files` `integer`
- `updated_at` `timestamptz`
- `overview` `text`
- `stage_drafts` `jsonb`
- `logs` `jsonb`
- `created_at` `timestamptz`

Допустимые `status`:

- `draft`
- `uploaded`
- `processing`
- `awaiting_review`
- `completed`
- `failed`

Допустимые `current_stage`:

- `source_compiled`
- `course_outline`
- `course_content`
- `course_test`

## Таблица `source_files`

- `id` `text`, PK
- `project_id` `text`, FK -> `projects.id`
- `original_name` `text`
- `mime_type` `text`
- `size_bytes` `bigint`
- `storage_key` `text`
- `upload_status` `text`
- `processing_status` `text`
- `kind` `text`
- `position` `integer`
- `created_at` `timestamptz`

Допустимые `upload_status`:

- `initiated`
- `uploading`
- `completed`
- `aborted`

Допустимые `processing_status`:

- `pending`
- `queued`
- `processing`
- `done`
- `failed`

## Таблица `upload_sessions`

- `id` `text`, PK
- `project_id` `text`, FK -> `projects.id`
- `source_file_id` `text`, FK -> `source_files.id`
- `s3_upload_id` `text`
- `status` `text`
- `created_at` `timestamptz`
- `completed_at` `timestamptz`, nullable
- `bucket` `text`
- `storage_key` `text`
- `original_name` `text`
- `mime_type` `text`
- `size_bytes` `bigint`
- `kind` `text`

## Таблица `processing_jobs`

- `id` `text`, PK
- `project_id` `text`, FK -> `projects.id`
- `stage` `text`
- `status` `text`
- `payload_json` `jsonb`
- `result_json` `jsonb`, nullable
- `error_text` `text`, nullable
- `started_at` `timestamptz`, nullable
- `finished_at` `timestamptz`, nullable
- `created_at` `timestamptz`

Допустимые `stage`:

- `source_compiled`
- `course_outline`
- `course_content`
- `course_test`

Допустимые `status`:

- `queued`
- `processing`
- `done`
- `failed`

## Таблица `artifacts`

- `id` `text`, PK
- `project_id` `text`, FK -> `projects.id`
- `stage` `text`
- `format` `text`
- `storage_key` `text`
- `content_md` `text`
- `content_json` `jsonb`
- `created_at` `timestamptz`
- `updated_at` `timestamptz`

Ограничения:

- `format` может быть только `md` или `json`
- есть `UNIQUE (project_id, stage, format)`

## Таблица `stage_reviews`

- `id` `text`, PK
- `project_id` `text`, FK -> `projects.id`
- `stage` `text`
- `source_artifact_id` `text`, FK -> `artifacts.id`
- `edited_artifact_id` `text`, FK -> `artifacts.id`
- `approved_at` `timestamptz`

Примечание: таблица уже есть в схеме и используется store-слоем, но отдельный HTTP endpoint подтверждения этапа пока не опубликован.
