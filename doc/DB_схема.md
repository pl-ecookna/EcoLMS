# Схема базы данных

Документ отражает текущую схему, которую сервис создаёт в [apps/api/src/db/postgres.service.ts](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/api/src/db/postgres.service.ts).

Для модуля `meetings` ниже перечислены уже добавленные backend-таблицы. Детальная проектная спецификация и правила их использования описаны в [Модуль_встреч.md](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/doc/Модуль_встреч.md).

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

## Таблица `llm_prompts`

- `module` `text`
- `prompt_key` `text`
- `title` `text`
- `system_prompt` `text`
- `user_prompt_template` `text`
- `created_at` `timestamptz`
- `updated_at` `timestamptz`

Ограничения:

- `PRIMARY KEY (module, prompt_key)`
- `module` может быть только `lms` или `meetings`

Назначение:

- хранит редактируемые промпты для обоих модулей без деплоя кода
- используется `worker`-ом как основной источник промптов
- при пустой таблице worker дозаписывает дефолтные prompt templates из кода

## Таблица `meetings`

- `id` `text`, PK
- `title` `text`
- `description` `text`
- `status` `text`
- `language` `text`
- `duration_seconds` `integer`, nullable
- `speakers_count` `integer`
- `processing_started_at` `timestamptz`, nullable
- `processing_finished_at` `timestamptz`, nullable
- `error_text` `text`, nullable
- `created_at` `timestamptz`
- `updated_at` `timestamptz`

Допустимые `status`:

- `draft`
- `uploaded`
- `processing`
- `completed`
- `failed`

## Таблица `meeting_source_files`

- `id` `text`, PK
- `meeting_id` `text`, FK -> `meetings.id`
- `original_name` `text`
- `mime_type` `text`
- `size_bytes` `bigint`
- `storage_key` `text`
- `upload_status` `text`
- `processing_status` `text`
- `duration_seconds` `integer`, nullable
- `audio_storage_key` `text`, nullable
- `audio_mime_type` `text`, nullable
- `created_at` `timestamptz`

Ограничение:

- `UNIQUE (meeting_id)`

## Таблица `meeting_upload_sessions`

- `id` `text`, PK
- `meeting_id` `text`, FK -> `meetings.id`
- `source_file_id` `text`, FK -> `meeting_source_files.id`
- `s3_upload_id` `text`
- `status` `text`
- `created_at` `timestamptz`
- `completed_at` `timestamptz`, nullable
- `bucket` `text`
- `storage_key` `text`
- `original_name` `text`
- `mime_type` `text`
- `size_bytes` `bigint`

Допустимые `status`:

- `initiated`
- `uploading`
- `completed`
- `aborted`

## Таблица `meeting_jobs`

- `id` `text`, PK
- `meeting_id` `text`, FK -> `meetings.id`
- `stage` `text`
- `status` `text`
- `payload_json` `jsonb`
- `result_json` `jsonb`, nullable
- `error_text` `text`, nullable
- `started_at` `timestamptz`, nullable
- `finished_at` `timestamptz`, nullable
- `created_at` `timestamptz`

Допустимые `stage`:

- `audio_prepared`
- `transcript_compiled`
- `meeting_summary`
- `meeting_protocol`
- `meeting_actions`

Допустимые `status`:

- `queued`
- `processing`
- `done`
- `failed`

## Таблица `meeting_speakers`

- `id` `text`, PK
- `meeting_id` `text`, FK -> `meetings.id`
- `speaker_label` `text`
- `display_name` `text`
- `is_user_edited` `boolean`
- `sort_order` `integer`
- `created_at` `timestamptz`
- `updated_at` `timestamptz`

Ограничение:

- `UNIQUE (meeting_id, speaker_label)`

## Таблица `meeting_speaker_segments`

- `id` `bigserial`, PK
- `meeting_id` `text`, FK -> `meetings.id`
- `speaker_id` `text`, FK -> `meeting_speakers.id`, nullable
- `speaker_label` `text`
- `start_ms` `integer`
- `end_ms` `integer`
- `text` `text`
- `confidence` `numeric`, nullable
- `provider_payload_json` `jsonb`
- `created_at` `timestamptz`

Индексы:

- `(meeting_id, start_ms)`
- `(meeting_id, speaker_label)`

## Таблица `meeting_artifacts`

- `id` `text`, PK
- `meeting_id` `text`, FK -> `meetings.id`
- `stage` `text`
- `format` `text`
- `content_md` `text`
- `content_json` `jsonb`
- `created_at` `timestamptz`
- `updated_at` `timestamptz`

Допустимые `stage`:

- `transcript_compiled`
- `meeting_summary`
- `meeting_protocol`
- `meeting_actions`

Допустимые `format`:

- `md`
- `json`

Ограничение:

- `UNIQUE (meeting_id, stage, format)`
