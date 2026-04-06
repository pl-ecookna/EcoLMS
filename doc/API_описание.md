# 🔌 API Endpoints

## Upload

### POST /upload/init
Инициализация multipart upload

### POST /upload/complete
Завершение загрузки

---

## Jobs

### POST /jobs/create
Создание задачи обработки

### GET /jobs/{id}
Получение статуса задачи

### POST /jobs/{id}/next
Переход к следующему этапу

---

## Results

### GET /jobs/{id}/result
Получение результата (JSON + MD)
