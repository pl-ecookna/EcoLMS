FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN python -m venv "$VIRTUAL_ENV" \
  && pip install --no-cache-dir --upgrade pip setuptools wheel

COPY apps/worker ./apps/worker
COPY certs ./certs

RUN pip install --no-cache-dir ./apps/worker

CMD ["ecolms-worker"]
