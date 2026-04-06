# API Описание

Все маршруты предполагаются под префиксом `/api`.

---

## Projects

### `POST /api/projects`
Создать проект.

### `GET /api/projects?page=1&limit=25`
Получить список проектов с пагинацией.

### `GET /api/projects/{id}`
Получить карточку проекта, его статус, список файлов и этапов.

### `POST /api/projects/{id}/start`
Запустить обработку проекта после завершения загрузки.

### `GET /api/projects/{id}/status`
Получить текущий статус проекта и активный этап.

---

## Uploads

### `POST /api/projects/{id}/uploads/init`
Инициализировать multipart upload для файла проекта.

### `POST /api/uploads/{uploadId}/parts/sign`
Получить signed URL для загрузки очередной части.

### `POST /api/uploads/{uploadId}/complete`
Завершить multipart upload.

### `POST /api/uploads/{uploadId}/abort`
Отменить multipart upload.

---

## Artifacts

### `GET /api/projects/{id}/artifacts`
Получить список артефактов проекта.

### `GET /api/projects/{id}/artifacts/{artifactId}`
Получить метаданные артефакта и ссылку на скачивание.

### `PUT /api/projects/{id}/artifacts/{artifactId}`
Сохранить отредактированную версию результата этапа.

### `POST /api/projects/{id}/artifacts/{artifactId}/approve`
Подтвердить результат этапа и разрешить запуск следующего этапа.

### `GET /api/projects/{id}/download`
Получить набор итоговых артефактов для скачивания.

---

## Jobs

### `GET /api/projects/{id}/jobs`
Получить список job по проекту.

### `POST /api/projects/{id}/jobs/{jobId}/retry`
Повторить неуспешный этап.

---

## Internal transcription service

### `POST /transcribe`
Принять аудиофайл или ссылку на файл и вернуть:

- текст;
- сегменты;
- метаданные выполнения.

### `GET /health`
Проверка доступности transcription service.

---

## Базовые форматы ответов

Для MVP рекомендуется единый формат:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

При ошибке:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "..."
  }
}
```

---

## Примечания

- Список проектов должен поддерживать пагинацию по 25 элементов.
- Все большие файлы загружаются напрямую в S3, backend не проксирует бинарные данные.
- Фронтенд не хранит постоянные S3 credentials.
