from __future__ import annotations

import json
import os
import socket
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row


@dataclass(slots=True)
class WorkerConfig:
    api_base_url: str = "http://localhost:3001"
    transcription_service_url: str = "http://localhost:3002"
    postgres_url: str = "postgresql://postgres:password@localhost:5432/ecolms"
    redis_url: str = "redis://localhost:6379"
    s3_bucket: str = "ecolms"
    job_queue_key: str = "ecolms:processing-jobs"


def normalize_service_url(value: str | None, *, default_prod: str, default_dev: str) -> str:
    if not value:
        return default_prod if os.getenv("NODE_ENV") == "production" else default_dev

    if any(
        marker in value
        for marker in (
            "api:3001",
            "transcription-service:3002",
            "localhost:3001",
            "localhost:3002",
            "127.0.0.1:3001",
            "127.0.0.1:3002",
        )
    ):
        return default_prod if os.getenv("NODE_ENV") == "production" else default_dev

    return value


def load_config() -> WorkerConfig:
    return WorkerConfig(
        api_base_url=normalize_service_url(
            os.getenv("API_BASE_URL"),
            default_prod="http://app-calculate-open-source-alarm-cob2f6:3001",
            default_dev="http://localhost:3001",
        ),
        transcription_service_url=normalize_service_url(
            os.getenv("TRANSCRIPTION_SERVICE_URL"),
            default_prod="http://app-copy-bluetooth-matrix-b869ye:3002",
            default_dev="http://localhost:3002",
        ),
        postgres_url=os.getenv(
            "POSTGRES_URL",
            "postgresql://postgres:password@localhost:5432/ecolms",
        ),
        redis_url=os.getenv("REDIS_URL", "redis://localhost:6379"),
        s3_bucket=os.getenv("S3_BUCKET", "ecolms"),
        job_queue_key=os.getenv("WORKER_JOB_QUEUE_KEY", "ecolms:processing-jobs"),
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def encode_resp(parts: list[str]) -> bytes:
    payload = [f"*{len(parts)}\r\n"]
    for part in parts:
        encoded = part.encode("utf-8")
        payload.append(f"${len(encoded)}\r\n")
        payload.append(part)
        payload.append("\r\n")
    return "".join(payload).encode("utf-8")


def parse_resp(buffer: bytes) -> tuple[Any, bytes] | None:
    if not buffer:
        return None

    prefix = buffer[:1]
    if prefix == b"+":
        end = buffer.find(b"\r\n")
        if end == -1:
            return None
        return buffer[1:end].decode("utf-8"), buffer[end + 2 :]

    if prefix == b":":
        end = buffer.find(b"\r\n")
        if end == -1:
            return None
        return int(buffer[1:end]), buffer[end + 2 :]

    if prefix == b"$":
        end = buffer.find(b"\r\n")
        if end == -1:
            return None
        length = int(buffer[1:end])
        if length == -1:
            return None, buffer[end + 2 :]
        start = end + 2
        stop = start + length
        if len(buffer) < stop + 2:
            return None
        return buffer[start:stop].decode("utf-8"), buffer[stop + 2 :]

    if prefix == b"*":
        end = buffer.find(b"\r\n")
        if end == -1:
            return None
        count = int(buffer[1:end])
        if count == -1:
            return None, buffer[end + 2 :]

        cursor = end + 2
        items: list[Any] = []
        for _ in range(count):
            decoded = parse_resp(buffer[cursor:])
            if decoded is None:
                return None
            value, rest = decoded
            items.append(value)
            cursor = len(buffer) - len(rest)
        return items, buffer[cursor:]

    if prefix == b"-":
        end = buffer.find(b"\r\n")
        if end == -1:
            return None
        raise RuntimeError(buffer[1:end].decode("utf-8"))

    return None


def redis_url_parts(redis_url: str) -> tuple[str, int]:
    parsed = urlparse(redis_url)
    return parsed.hostname or "localhost", parsed.port or 6379


def redis_command(redis_url: str, *parts: str, timeout: float = 6.0) -> Any:
    host, port = redis_url_parts(redis_url)
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(encode_resp(list(parts)))
        buffer = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                raise RuntimeError("Redis connection closed")
            buffer += chunk
            decoded = parse_resp(buffer)
            if decoded is not None:
                value, _ = decoded
                return value


def make_stage_markdown(project_name: str, stage: str, topic: str) -> str:
    if stage == "source_compiled":
        return (
            f"# {project_name}\n\n"
            "## Что уже известно\n"
            f"- {topic}\n"
            "- Совмещаем видео и документы в одном проекте.\n"
            "- Итог хранится только в S3.\n\n"
            "## Что удаляем\n"
            "- контакты, если они не нужны для обучения;\n"
            "- рекламный шум;\n"
            "- повторы из вебинаров.\n"
        )

    if stage == "course_outline":
        return (
            "# План курса\n\n"
            f"1. Введение в {topic}\n"
            "2. Ключевые материалы\n"
            "3. Практика и примеры\n"
            "4. Типовые ошибки\n"
            "5. Проверка понимания\n"
        )

    if stage == "course_content":
        return (
            "# Обучающие материалы\n\n"
            "## Раздел 1. Введение\n"
            "Кратко объясняем, зачем нужен материал и кому он адресован.\n\n"
            "## Раздел 2. Практика\n"
            "Даём пошаговые инструкции без жаргона и лишних деталей.\n"
        )

    return (
        "# Тест\n\n"
        "1. Какой шаг следует после source_compiled?\n"
        "   - План курса\n"
        "   - Список файлов\n"
        "   - Архив проекта\n"
        "2. Сколько вопросов должно быть в тесте?\n"
        "   - 5\n"
        "   - 10\n"
        "   - 15\n"
    )


def ensure_stage_artifact(conn: psycopg.Connection, job: dict[str, Any], markdown: str) -> None:
    conn.execute(
        """
        update artifacts
        set content_md = %s,
            content_json = %s::jsonb,
            updated_at = now()
        where project_id = %s and stage = %s and format = 'md'
        """,
        (
            markdown,
            json.dumps({"stage": job["stage"], "markdown": markdown}, ensure_ascii=False),
            job["project_id"],
            job["stage"],
        ),
    )
    conn.execute(
        """
        update artifacts
        set content_json = %s::jsonb,
            updated_at = now()
        where project_id = %s and stage = %s and format = 'json'
        """,
        (
            json.dumps({"stage": job["stage"], "markdown": markdown}, ensure_ascii=False),
            job["project_id"],
            job["stage"],
        ),
    )


def load_project(conn: psycopg.Connection, project_id: str) -> dict[str, Any]:
    row = conn.execute(
        "select * from projects where id = %s limit 1",
        (project_id,),
    ).fetchone()
    if row is None:
        raise RuntimeError(f"Project not found: {project_id}")
    return dict(row)


def load_job(conn: psycopg.Connection, job_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "select * from processing_jobs where id = %s limit 1",
        (job_id,),
    ).fetchone()
    return dict(row) if row else None


def append_project_log(conn: psycopg.Connection, project_id: str, message: str) -> None:
    row = conn.execute(
        "select logs from projects where id = %s limit 1",
        (project_id,),
    ).fetchone()
    logs = []
    if row and row["logs"]:
        logs = list(row["logs"])
    logs = [message, *logs][:10]
    conn.execute(
        "update projects set logs = %s::jsonb, updated_at = now() where id = %s",
        (json.dumps(logs, ensure_ascii=False), project_id),
    )


def set_job_processing(conn: psycopg.Connection, job_id: str) -> None:
    conn.execute(
        """
        update processing_jobs
        set status = 'processing', started_at = now(), error_text = null
        where id = %s
        """,
        (job_id,),
    )


def set_job_done(conn: psycopg.Connection, job_id: str, stage: str) -> None:
    conn.execute(
        """
        update processing_jobs
        set status = 'done',
            result_json = %s::jsonb,
            finished_at = now()
        where id = %s
        """,
        (
            json.dumps(
                {
                    "status": "done",
                    "stage": stage,
                    "generatedAt": utc_now(),
                },
                ensure_ascii=False,
            ),
            job_id,
        ),
    )


def set_job_failed(conn: psycopg.Connection, job_id: str, error_text: str) -> None:
    conn.execute(
        """
        update processing_jobs
        set status = 'failed',
            error_text = %s,
            finished_at = now()
        where id = %s
        """,
        (error_text, job_id),
    )


def process_job(config: WorkerConfig, job_message: dict[str, Any]) -> None:
    conn = psycopg.connect(config.postgres_url, row_factory=dict_row)
    try:
        job = load_job(conn, job_message["jobId"])
        if job is None:
            print(
                json.dumps(
                    {
                        "service": "worker",
                        "status": "skipped",
                        "reason": "job-missing",
                        "jobId": job_message["jobId"],
                    },
                    ensure_ascii=False,
                )
            )
            return

        if job["status"] == "done":
            print(
                json.dumps(
                    {
                        "service": "worker",
                        "status": "skipped",
                        "reason": "already-done",
                        "jobId": job_message["jobId"],
                    },
                    ensure_ascii=False,
                )
            )
            return

        project = load_project(conn, job["project_id"])
        markdown = make_stage_markdown(
            project["name"], job["stage"], project["source_summary"]
        )

        with conn.transaction():
            set_job_processing(conn, job["id"])
            append_project_log(conn, project["id"], f"Worker начал обработку job {job['stage']}.")
            ensure_stage_artifact(conn, job, markdown)
            set_job_done(conn, job["id"], job["stage"])
            conn.execute(
                """
                update projects
                set
                  status = 'awaiting_review',
                  progress = case
                    when current_stage = 'source_compiled' then 18
                    when current_stage = 'course_outline' then 44
                    when current_stage = 'course_content' then 68
                    when current_stage = 'course_test' then 88
                    else progress
                  end,
                  updated_at = now()
                where id = %s
                """,
                (project["id"],),
            )

        print(
            json.dumps(
                {
                    "service": "worker",
                    "status": "done",
                    "jobId": job["id"],
                    "projectId": project["id"],
                    "stage": job["stage"],
                },
                ensure_ascii=False,
            )
        )
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        try:
            set_job_failed(conn, job_message["jobId"], str(exc))
            conn.commit()
        except Exception:
            pass
        print(
            json.dumps(
                {"service": "worker", "status": "failed", "error": str(exc)},
                ensure_ascii=False,
            )
        )
    finally:
        conn.close()


def drain_queue(config: WorkerConfig) -> None:
    print(
        json.dumps(
            {"service": "worker", "config": asdict(config), "queue": config.job_queue_key},
            ensure_ascii=False,
            indent=2,
        )
    )

    while True:
        try:
            raw_message = redis_command(
                config.redis_url,
                "BRPOP",
                config.job_queue_key,
                "5",
                timeout=6,
            )
            if not raw_message:
                print(json.dumps({"service": "worker", "status": "heartbeat"}, ensure_ascii=False))
                continue

            if isinstance(raw_message, list):
                raw_message = raw_message[-1]

            message = json.loads(raw_message)
            process_job(config, message)
        except KeyboardInterrupt:
            print(json.dumps({"service": "worker", "status": "stopped"}, ensure_ascii=False))
            return
        except Exception as exc:
            print(
                json.dumps(
                    {"service": "worker", "status": "error", "error": str(exc)},
                    ensure_ascii=False,
                )
            )
            time.sleep(2)


def main() -> None:
    drain_queue(load_config())


if __name__ == "__main__":
    main()
