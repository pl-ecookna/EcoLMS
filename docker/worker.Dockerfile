FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY apps/worker ./apps/worker

CMD ["python", "apps/worker/src/worker/main.py"]
