FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV TRANSCRIPTION_PORT=3002

COPY apps/transcription-service ./apps/transcription-service

EXPOSE 3002

CMD ["python", "apps/transcription-service/src/transcription_service/main.py"]
