FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY apps/worker ./apps/worker

RUN pip install --no-cache-dir ./apps/worker

CMD ["python", "apps/worker/src/worker/main.py"]
