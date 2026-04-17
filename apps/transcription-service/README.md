# Transcription service

Сервис транскрибации EcoLMS на Python с `faster-whisper`.

## Что делает сейчас

- поднимает HTTP API на встроенном `HTTPServer`;
- принимает `POST /transcribe`;
- умеет брать источник из S3, URL или локального пути;
- приводит аудио к `16kHz mono wav` через `ffmpeg`;
- транскрибирует запись через `faster-whisper`;
- отдаёт текст, сегменты, длительность, язык и метаданные источника;
- отвечает на `GET /health`.

## Ключевой файл

- [apps/transcription-service/src/transcription_service/main.py](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/apps/transcription-service/src/transcription_service/main.py)
