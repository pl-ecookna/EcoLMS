# 📊 Схема базы данных (PostgreSQL)

## Таблица: users
- id (uuid, PK)
- email (text)
- created_at (timestamp)

## Таблица: uploads
- id (uuid, PK)
- user_id (uuid, FK)
- file_name (text)
- file_size (bigint)
- s3_key (text)
- status (text)
- created_at (timestamp)

## Таблица: jobs
- id (uuid, PK)
- upload_id (uuid, FK)
- stage (text)
- status (text)
- result_json (jsonb)
- result_md (text)
- created_at (timestamp)

## Статусы jobs
- queued
- processing
- done
- failed
