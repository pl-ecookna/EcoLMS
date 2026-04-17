# API описание

Все внешние маршруты backend доступны под префиксом `/api`.

## Актуальные маршруты

### Health

- `GET /api/health`
  Возвращает сводку по `api`, `postgres`, `redis`, `openai`, `worker`, `transcriptionService`, а также счётчики проектов и upload-сессий.

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
