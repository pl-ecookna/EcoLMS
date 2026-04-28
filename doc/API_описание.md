# API описание

Все внешние маршруты backend доступны под префиксом `/api`.

Примечание: ниже описан реализованный API текущих модулей `courses` и `meetings`. Детальная проектная спецификация по `meetings`, включая worker pipeline и целевую модель данных, вынесена в [Модуль_встреч.md](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/doc/Модуль_встреч.md).

## Актуальные маршруты

### Health

- `GET /api/health`
  Возвращает сводку по `api`, `postgres`, `redis`, `llm`, `salutespeech`, `worker`, `transcriptionService`, а также счётчики проектов и upload-сессий.

### Projects

- `POST /api/projects`
  Создаёт проект.

  Тело запроса:

  ```json
  {
    "name": "Курс по продукту",
    "githubRef": "https://github.com/org/repo",
    "note": "Краткое описание проекта"
  }
  ```

- `GET /api/projects?page=1&limit=25`
  Возвращает список проектов с пагинацией. `limit` ограничен значением `25`.

- `GET /api/projects/{id}`
  Возвращает расширенную карточку проекта:
  source files, jobs, artifacts, reviews, stage drafts и статусы этапов.

- `PATCH /api/projects/{id}`
  Обновляет `name` и `note`.

- `DELETE /api/projects/{id}`
  Удаляет проект.

- `DELETE /api/projects/{id}/source-files/{sourceFileId}`
  Удаляет исходный файл проекта.

- `POST /api/projects/{id}/start`
  Ставит в очередь начальную обработку для текущего этапа проекта.

- `POST /api/projects/{id}/generate`
  Запускает генерацию конкретного этапа.

  Тело запроса:

  ```json
  {
    "stage": "course_outline",
    "autoGenerateAll": false,
    "overwriteExisting": false
  }
  ```

- `GET /api/projects/{id}/status`
  Возвращает компактный статус проекта.

- `GET /api/projects/{id}/download`
  Возвращает список артефактов с `downloadUrl`.

### Uploads

- `POST /api/projects/{id}/uploads/init`
  Инициализирует multipart upload.

  Тело запроса:

  ```json
  {
    "fileName": "manual.pdf",
    "fileSize": 1024,
    "mimeType": "application/pdf",
    "kind": "document"
  }
  ```

- `POST /api/uploads/{uploadId}/parts/sign`
  Выдаёт signed URL для конкретной части.

  Тело запроса:

  ```json
  {
    "partNumber": 1
  }
  ```

- `POST /api/uploads/{uploadId}/complete`
  Завершает multipart upload и переводит файл в `completed`.

- `POST /api/uploads/{uploadId}/abort`
  Прерывает upload.

### Artifacts

- `GET /api/projects/{id}/artifacts`
  Возвращает список артефактов проекта.

- `GET /api/projects/{id}/artifacts/{artifactId}`
  Возвращает один артефакт.

- `PUT /api/projects/{id}/artifacts/{artifactId}`
  Сохраняет обновлённый `contentMd`.

  Тело запроса:

  ```json
  {
    "contentMd": "# Обновлённый markdown"
  }
  ```

Примечание: логика `approveArtifact` в store уже есть, но публичный маршрут подтверждения этапа сейчас не опубликован контроллером.

### Jobs

- `GET /api/projects/{id}/jobs`
  Возвращает список задач проекта.

- `POST /api/projects/{id}/jobs/{jobId}/retry`
  Повторно ставит задачу в очередь.

### Meetings

- `POST /api/meetings`
  Создаёт встречу.

- `GET /api/meetings?page=1&limit=25`
  Возвращает список встреч с пагинацией.

- `GET /api/meetings/{id}`
  Возвращает карточку встречи:
  source file, speakers, segments, jobs и artifacts.

- `PATCH /api/meetings/{id}`
  Обновляет `title` и `description`.

- `DELETE /api/meetings/{id}`
  Удаляет встречу.

### Meeting uploads

- `POST /api/meetings/{id}/uploads/init`
  Инициализирует upload исходного файла встречи.

- `POST /api/meeting-uploads/{uploadId}/parts/sign`
  Выдаёт signed URL для загрузки части файла.

- `POST /api/meeting-uploads/{uploadId}/complete`
  Завершает upload.

- `POST /api/meeting-uploads/{uploadId}/abort`
  Прерывает upload.

### Meeting processing

- `POST /api/meetings/{id}/start`
  Ставит встречу в очередь обработки с начального шага `audio_prepared`.

- `POST /api/meetings/{id}/generate`
  Ставит в очередь отдельный этап:
  `transcript_compiled`, `meeting_summary`, `meeting_protocol`, `meeting_actions`.

- `GET /api/meetings/{id}/status`
  Возвращает компактный статус встречи.

### Meeting transcript

- `GET /api/meetings/{id}/transcript`
  Возвращает diarized transcript со speakers и segments.

- `GET /api/meetings/{id}/segments`
  Возвращает только список сегментов.

- `PATCH /api/meetings/{id}/speakers/{speakerId}`
  Обновляет отображаемое имя спикера.

### Meeting artifacts

- `GET /api/meetings/{id}/artifacts`
  Возвращает список артефактов встречи.

- `GET /api/meetings/{id}/artifacts/{artifactId}`
  Возвращает один артефакт.

- `PUT /api/meetings/{id}/artifacts/{artifactId}`
  Сохраняет `contentMd` и, при необходимости, `contentJson`.

### Meeting jobs

- `GET /api/meetings/{id}/jobs`
  Возвращает список задач встречи.

- `POST /api/meetings/{id}/jobs/{jobId}/retry`
  Повторно ставит задачу встречи в очередь.

### Meeting export

- `GET /api/meetings/{id}/download`
  Возвращает список доступных экспортов встречи.

### Prompt management

- `GET /api/prompts`
  Возвращает список всех редактируемых промптов.

- `GET /api/prompts?module=lms`
  Возвращает только промпты выбранного модуля: `lms` или `meetings`.

- `GET /api/prompts/{module}/{promptKey}`
  Возвращает один промпт по ключу.

- `PATCH /api/prompts/{module}/{promptKey}`
  Обновляет `title`, `systemPrompt`, `userPromptTemplate`.

## Формат ответа

Успешный ответ:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

Формат ошибки в текущем API может отличаться по деталям в зависимости от источника ошибки, но envelope остаётся тем же:

```json
{
  "success": false,
  "data": null,
  "error": "..."
}
```

## Internal transcription service

Этот сервис не публикуется наружу через `/api`, но используется `worker` и Docker stack.

- `GET /health`
- `POST /transcribe`
