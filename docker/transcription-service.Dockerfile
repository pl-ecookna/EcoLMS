FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV TRANSCRIPTION_PORT=3002
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

COPY apps/transcription-service ./apps/transcription-service
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN python -m venv "$VIRTUAL_ENV" \
    && pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir --retries 10 --timeout 600 ./apps/transcription-service

EXPOSE 3002

CMD ["python", "apps/transcription-service/src/transcription_service/main.py"]
