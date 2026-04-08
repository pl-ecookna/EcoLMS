from __future__ import annotations

import json
import os
import socket
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import urlparse, unquote

import psycopg
from psycopg.rows import dict_row

from worker.prompts import prompt_bundle_for_stage, PROMPTS


@dataclass(slots=True)
class WorkerConfig:
    api_base_url: str = "http://localhost:3101"
    transcription_service_url: str = "http://localhost:3002"
    postgres_url: str = "postgresql://postgres:password@localhost:5432/ecolms"
    redis_url: str = "redis://localhost:6379"
    s3_endpoint: str = "https://s3.example.invalid"
    s3_bucket: str = "ecolms"
    s3_region: str = "ru-1"
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    openai_api_key: str = ""
    openrouter_api_key: str = ""
    llm_primary_provider: str = "openai"
    openai_model: str = "gpt-4.1-mini"
    openrouter_model: str = "openai/gpt-4.1-mini"
    openrouter_base_url: str = "https://openrouter.ai/api/v1/chat/completions"
    llm_timeout_seconds: float = 120.0
    job_queue_key: str = "ecolms:processing-jobs"


INTERNAL_POSTGRES_URL = (
    "postgresql://postgres:postgres@postgres:5432/ecolms"
)
EXTERNAL_POSTGRES_URL = (
    "postgresql://postgres:postgres@localhost:5434/ecolms"
)
INTERNAL_REDIS_URL = "redis://redis:6379"
EXTERNAL_REDIS_URL = "redis://localhost:6381"


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
            default_dev="http://localhost:3101",
        ),
        transcription_service_url=normalize_service_url(
            os.getenv("TRANSCRIPTION_SERVICE_URL"),
            default_prod="http://app-copy-bluetooth-matrix-b869ye:3002",
            default_dev="http://localhost:3002",
        ),
        postgres_url=normalize_service_url(
            os.getenv("POSTGRES_URL"),
            default_prod=INTERNAL_POSTGRES_URL,
            default_dev=EXTERNAL_POSTGRES_URL,
        ),
        redis_url=normalize_service_url(
            os.getenv("REDIS_URL"),
            default_prod=INTERNAL_REDIS_URL,
            default_dev=EXTERNAL_REDIS_URL,
        ),
        s3_endpoint=os.getenv("S3_ENDPOINT", "https://s3.example.invalid"),
        s3_bucket=os.getenv("S3_BUCKET", "ecolms"),
        s3_region=os.getenv("S3_REGION", "ru-1"),
        s3_access_key_id=os.getenv("S3_ACCESS_KEY_ID", ""),
        s3_secret_access_key=os.getenv("S3_SECRET_ACCESS_KEY", ""),
        openai_api_key=os.getenv("OPENAI_API_KEY", ""),
        openrouter_api_key=os.getenv("OPENROUTER_API_KEY", ""),
        llm_primary_provider=os.getenv("LLM_PRIMARY_PROVIDER", "openai").strip().lower(),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        openrouter_model=os.getenv("OPENROUTER_MODEL", "openai/gpt-4.1-mini"),
        openrouter_base_url=os.getenv(
            "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1/chat/completions"
        ),
        llm_timeout_seconds=float(os.getenv("LLM_TIMEOUT_SECONDS", "120")),
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


def redis_url_parts(redis_url: str) -> tuple[str, int, str | None, str | None, int]:
    parsed = urlparse(redis_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    username = unquote(parsed.username) if parsed.username else None
    password = unquote(parsed.password) if parsed.password else None
    db = 0
    if parsed.path and parsed.path != "/":
        try:
            db = int(parsed.path.lstrip("/"))
        except ValueError:
            db = 0
    return host, port, username, password, db


def redis_command(redis_url: str, *parts: str, timeout: float = 6.0) -> Any:
    host, port, username, password, db = redis_url_parts(redis_url)
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        if password:
            auth_parts = ["AUTH"]
            if username:
                auth_parts.extend([username, password])
            else:
                auth_parts.append(password)
            sock.sendall(encode_resp(auth_parts))
            auth_buffer = b""
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    raise RuntimeError("Redis connection closed during AUTH")
                auth_buffer += chunk
                decoded = parse_resp(auth_buffer)
                if decoded is not None:
                    break

        if db > 0:
            sock.sendall(encode_resp(["SELECT", str(db)]))
            select_buffer = b""
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    raise RuntimeError("Redis connection closed during SELECT")
                select_buffer += chunk
                decoded = parse_resp(select_buffer)
                if decoded is not None:
                    break

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
            "## Сводка по исходным материалам\n"
            f"{topic}\n\n"
            "## Что должно войти в структурированный источник\n"
            "- технические характеристики и параметры;\n"
            "- инструкции, алгоритмы и методики;\n"
            "- требования безопасности;\n"
            "- контроль качества и типовые ошибки;\n"
            "- инструменты, материалы и термины.\n\n"
            "## Что исключаем из учебной версии\n"
            "- контакты, реквизиты и внешние ссылки;\n"
            "- организационные объявления и приветствия;\n"
            "- маркетинговые и юридические блоки.\n\n"
            "## Комментарий\n"
            "Черновик собран по правилам очистки исходников и готов к ручной проверке.\n"
        )

    if stage == "course_outline":
        return (
            "# План курса\n\n"
            f"**Основа курса:** {topic}\n\n"
            "## Разделы курса\n"
            "1. Введение в продукт, систему или технологию\n"
            "2. Ключевые технические сведения и параметры\n"
            "3. Основные операции и порядок выполнения работ\n"
            "4. Контроль качества и типовые ошибки\n"
            "5. Безопасность и итоговая проверка знаний\n\n"
            "## Ключевые навыки после обучения\n"
            "- ориентироваться в исходных материалах;\n"
            "- понимать последовательность работ;\n"
            "- видеть требования к качеству и безопасности.\n"
        )

    if stage == "course_content":
        return (
            "# Обучающие материалы\n\n"
            "## Цели обучения\n"
            "- Сформировать прикладное понимание темы на основе утверждённого плана.\n"
            "- Подготовить материал для практического использования в работе.\n\n"
            "## Теоретическая часть\n"
            f"{topic}\n\n"
            "## Практическое применение\n"
            "1. Выполнить действия в порядке, описанном в исходных материалах.\n"
            "2. Проверить соблюдение технических требований и допусков.\n"
            "3. Зафиксировать контрольные точки качества.\n\n"
            "## Важные замечания\n"
            "> Если данных из исходников недостаточно для полного раскрытия раздела, это нужно явно отметить при доработке материала.\n"
        )

    return (
        "# Тест\n\n"
        "1. Какой принцип обязателен при создании учебного контента?\n"
        "   - Использовать только данные из исходных материалов ✅\n"
        "   - Добавлять сведения из внешних источников\n"
        "   - Сокращать технические требования по усмотрению автора\n\n"
        "2. Что должно быть отражено в хорошем учебном материале?\n"
        "   - Только маркетинговые преимущества\n"
        "   - Контроль качества, безопасность и порядок действий ✅\n"
        "   - Только перечень файлов проекта\n"
    )


def extract_summary(text: str, limit: int = 1500) -> str:
    compact = " ".join(text.split())
    if not compact:
        return "Транскрипт получен, но текст пуст."
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit].rstrip()}..."


def parse_json_from_text(value: str) -> dict[str, Any]:
    raw = value.strip()
    if not raw:
        raise RuntimeError("Пустой ответ LLM.")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise RuntimeError("LLM вернул невалидный JSON.")
        parsed = json.loads(raw[start : end + 1])
    if not isinstance(parsed, dict):
        raise RuntimeError("LLM вернул невалидную JSON-структуру.")
    return parsed


def openai_chat_completion(
    api_key: str, model: str, messages: list[dict[str, str]], timeout_seconds: float
) -> tuple[str, str]:
    request_payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    req = urlrequest.Request(
        "https://api.openai.com/v1/chat/completions",
        method="POST",
        data=json.dumps(request_payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    with urlrequest.urlopen(req, timeout=timeout_seconds) as response:
        body = json.loads(response.read().decode("utf-8"))
    content = (
        body.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("OpenAI вернул пустой ответ.")
    model_name = str(body.get("model") or model)
    return content, model_name


def openrouter_chat_completion(
    api_key: str,
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    timeout_seconds: float,
) -> tuple[str, str]:
    request_payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    req = urlrequest.Request(
        base_url,
        method="POST",
        data=json.dumps(request_payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json; charset=utf-8",
            "HTTP-Referer": "https://ecolms.local",
            "X-Title": "EcoLMS Worker",
        },
    )
    with urlrequest.urlopen(req, timeout=timeout_seconds) as response:
        body = json.loads(response.read().decode("utf-8"))
    content = (
        body.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("OpenRouter вернул пустой ответ.")
    model_name = str(body.get("model") or model)
    return content, model_name


def analyze_source_with_llm(config: WorkerConfig, transcript_text: str) -> dict[str, Any]:
    prompt = PROMPTS["analize_video"].text
    if not transcript_text.strip():
        raise RuntimeError("Невозможно вызвать LLM: транскрипт пуст.")

    user_payload = {
        "task": "Проанализируй транскрипт видео и верни только JSON с полями summary и transcript.",
        "transcript": transcript_text,
    }
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
    ]

    available_providers: list[str] = []
    if config.openai_api_key.strip():
        available_providers.append("openai")
    if config.openrouter_api_key.strip():
        available_providers.append("openrouter")
    if not available_providers:
        raise RuntimeError("OPENAI_API_KEY или OPENROUTER_API_KEY не заданы.")

    primary = config.llm_primary_provider
    if primary not in ("openai", "openrouter"):
        primary = "openai"
    ordered = [primary, "openrouter" if primary == "openai" else "openai"]
    ordered = [provider for provider in ordered if provider in available_providers]

    attempts: list[dict[str, Any]] = []
    for provider in ordered:
        try:
            if provider == "openai":
                content, model_name = openai_chat_completion(
                    config.openai_api_key,
                    config.openai_model,
                    messages,
                    config.llm_timeout_seconds,
                )
            else:
                content, model_name = openrouter_chat_completion(
                    config.openrouter_api_key,
                    config.openrouter_base_url,
                    config.openrouter_model,
                    messages,
                    config.llm_timeout_seconds,
                )

            parsed = parse_json_from_text(content)
            summary = str(parsed.get("summary") or "").strip()
            transcript = str(parsed.get("transcript") or "").strip()
            if not summary:
                summary = extract_summary(transcript_text)
            if not transcript:
                transcript = transcript_text
            return {
                "summary": summary,
                "transcript": transcript,
                "provider": provider,
                "model": model_name,
                "attempts": attempts + [{"provider": provider, "ok": True}],
            }
        except Exception as exc:
            attempts.append({"provider": provider, "ok": False, "error": str(exc)})

    details = "; ".join(
        f"{item['provider']}: {item['error']}" for item in attempts if not item["ok"]
    )
    raise RuntimeError(f"Все LLM-провайдеры завершились ошибкой: {details}")


def stage_prompt_metadata(stage: str) -> dict[str, Any]:
    prompts = prompt_bundle_for_stage(stage)
    return {
        "promptKeys": [item.key for item in prompts],
        "promptTitles": [item.title for item in prompts],
        "promptTexts": [item.text for item in prompts],
    }


STAGE_ORDER = ["source_compiled", "course_outline", "course_content", "course_test"]


def next_stage(stage: str) -> str | None:
    try:
        index = STAGE_ORDER.index(stage)
    except ValueError:
        return None
    return STAGE_ORDER[index + 1] if index + 1 < len(STAGE_ORDER) else None


def progress_for_stage(stage: str, *, completed: bool) -> int:
    if completed:
        return 100
    if stage == "source_compiled":
        return 18
    if stage == "course_outline":
        return 44
    if stage == "course_content":
        return 68
    if stage == "course_test":
        return 88
    return 0


def ensure_stage_artifact(
    conn: psycopg.Connection, job: dict[str, Any], markdown: str, metadata: dict[str, Any]
) -> None:
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
            json.dumps(
                {"stage": job["stage"], "markdown": markdown, **metadata},
                ensure_ascii=False,
            ),
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
            json.dumps(
                {"stage": job["stage"], "markdown": markdown, **metadata},
                ensure_ascii=False,
            ),
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


def load_source_files(conn: psycopg.Connection, project_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        select * from source_files
        where project_id = %s and upload_status = 'completed'
        order by position asc, created_at asc
        """,
        (project_id,),
    ).fetchall()
    return [dict(item) for item in rows]


def pick_video_source_file(files: list[dict[str, Any]]) -> dict[str, Any] | None:
    for source_file in files:
        mime_type = str(source_file.get("mime_type") or "").lower()
        kind = str(source_file.get("kind") or "").lower()
        if mime_type.startswith("video/") or kind == "video":
            return source_file
    return None


def call_transcription_service(
    config: WorkerConfig, source_file: dict[str, Any], timeout_seconds: float = 1200.0
) -> dict[str, Any]:
    endpoint = f"{config.transcription_service_url.rstrip('/')}/transcribe"
    payload = {
        "source": {
            "bucket": config.s3_bucket,
            "key": source_file["storage_key"],
            "originalName": source_file.get("original_name"),
            "mimeType": source_file.get("mime_type"),
        },
        "s3": {
            "endpoint": config.s3_endpoint,
            "bucket": config.s3_bucket,
            "region": config.s3_region,
            "accessKeyId": config.s3_access_key_id,
            "secretAccessKey": config.s3_secret_access_key,
        },
    }
    req = urlrequest.Request(
        endpoint,
        method="POST",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urlrequest.urlopen(req, timeout=timeout_seconds) as response:
            raw = response.read().decode("utf-8")
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(
            f"Transcription service HTTP {exc.code}: {detail or exc.reason}"
        ) from exc
    except urlerror.URLError as exc:
        raise RuntimeError(f"Transcription service недоступен: {exc.reason}") from exc

    body = json.loads(raw)
    if not body.get("success"):
        error_payload = body.get("error") or {}
        message = error_payload.get("message") or "Ошибка транскрибации"
        raise RuntimeError(str(message))
    data = body.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("Transcription service вернул невалидный payload")
    return data


def load_job(conn: psycopg.Connection, job_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "select * from processing_jobs where id = %s limit 1",
        (job_id,),
    ).fetchone()
    return dict(row) if row else None


def recover_missing_job(
    conn: psycopg.Connection, job_message: dict[str, Any]
) -> dict[str, Any] | None:
    job_id = str(job_message.get("jobId") or "").strip()
    project_id = str(job_message.get("projectId") or "").strip()
    stage = str(job_message.get("stage") or "").strip()
    trigger = str(job_message.get("trigger") or "auto").strip() or "auto"

    if not job_id or not project_id or not stage:
        return None

    if stage not in STAGE_ORDER:
        return None

    prompt_keys = [prompt.key for prompt in prompt_bundle_for_stage(stage)]

    conn.execute(
        """
        insert into processing_jobs (
          id, project_id, stage, status, payload_json, result_json, error_text, started_at, finished_at, created_at
        ) values (
          %s, %s, %s, 'queued', %s::jsonb, null, null, null, null, now()
        )
        on conflict (id) do nothing
        """,
        (
            job_id,
            project_id,
            stage,
            json.dumps(
                {
                    "stage": stage,
                    "trigger": trigger,
                    "promptKeys": prompt_keys,
                    "autoGenerateAll": trigger == "auto",
                    "nextStage": None,
                },
                ensure_ascii=False,
            ),
        ),
    )
    return load_job(conn, job_id)


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


def set_job_done(
    conn: psycopg.Connection, job_id: str, stage: str, metadata: dict[str, Any]
) -> None:
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
                    **metadata,
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
    # Use autocommit mode so `with conn.transaction()` always creates a real
    # top-level transaction. Otherwise prior SELECT opens an implicit outer
    # transaction and later writes can be rolled back on connection close.
    conn = psycopg.connect(config.postgres_url, row_factory=dict_row, autocommit=True)
    try:
        job = load_job(conn, job_message["jobId"])
        if job is None:
            try:
                with conn.transaction():
                    recovered = recover_missing_job(conn, job_message)
                if recovered is not None:
                    job = recovered
                    print(
                        json.dumps(
                            {
                                "service": "worker",
                                "status": "recovered",
                                "reason": "job-created-from-queue-message",
                                "jobId": job_message["jobId"],
                            },
                            ensure_ascii=False,
                        )
                    )
            except Exception:
                recovered = None

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
        transcription_data: dict[str, Any] | None = None
        llm_data: dict[str, Any] | None = None
        source_file: dict[str, Any] | None = None
        topic_for_markdown = project["source_summary"]
        if job["stage"] == "source_compiled":
            source_files = load_source_files(conn, project["id"])
            source_file = pick_video_source_file(source_files)
            if source_file is not None:
                transcription_data = call_transcription_service(config, source_file)
                transcript_text = str(transcription_data.get("text") or "").strip()
                llm_data = analyze_source_with_llm(config, transcript_text)
                topic_for_markdown = str(llm_data.get("summary") or "").strip() or extract_summary(
                    transcript_text
                )

        markdown = make_stage_markdown(project["name"], job["stage"], topic_for_markdown)
        payload = job.get("payload_json") or {}
        if isinstance(payload, str):
            payload = json.loads(payload)
        prompt_metadata = stage_prompt_metadata(job["stage"])
        stage_metadata = dict(prompt_metadata)
        if transcription_data is not None and source_file is not None:
            stage_metadata["transcription"] = {
                "sourceFileId": source_file["id"],
                "sourceStorageKey": source_file["storage_key"],
                "sourceOriginalName": source_file.get("original_name"),
                "sourceMimeType": source_file.get("mime_type"),
                "model": transcription_data.get("model"),
                "duration": transcription_data.get("duration"),
                "textLength": len(str(transcription_data.get("text") or "")),
                "segmentsCount": len(transcription_data.get("segments") or []),
            }
        if llm_data is not None:
            stage_metadata["llm"] = {
                "provider": llm_data.get("provider"),
                "model": llm_data.get("model"),
                "attempts": llm_data.get("attempts"),
                "summaryLength": len(str(llm_data.get("summary") or "")),
                "transcriptLength": len(str(llm_data.get("transcript") or "")),
            }
        auto_generate_all = bool(payload.get("autoGenerateAll"))
        queued_next_stage = payload.get("nextStage")
        if queued_next_stage is not None and not isinstance(queued_next_stage, str):
            queued_next_stage = None
        resolved_next_stage = queued_next_stage or (
            next_stage(job["stage"]) if auto_generate_all else None
        )
        should_finish_course = resolved_next_stage is None and job["stage"] == "course_test"
        next_job_payload = None

        with conn.transaction():
            set_job_processing(conn, job["id"])
            append_project_log(conn, project["id"], f"Worker начал обработку job {job['stage']}.")
            ensure_stage_artifact(conn, job, markdown, stage_metadata)
            set_job_done(conn, job["id"], job["stage"], stage_metadata)
            if resolved_next_stage:
                next_job_id = f"{project['id']}-{resolved_next_stage}-{int(time.time() * 1000)}"
                next_job_payload = {
                    "jobId": next_job_id,
                    "projectId": project["id"],
                    "stage": resolved_next_stage,
                    "trigger": "auto" if auto_generate_all else "manual",
                }
                conn.execute(
                    """
                    insert into processing_jobs (
                      id, project_id, stage, status, payload_json, result_json, error_text, started_at, finished_at, created_at
                    ) values (
                      %s, %s, %s, 'queued', %s::jsonb, null, null, null, null, now()
                    )
                    """,
                    (
                        next_job_id,
                        project["id"],
                        resolved_next_stage,
                        json.dumps(
                            {
                                "stage": resolved_next_stage,
                                "trigger": "auto" if auto_generate_all else "manual",
                                "autoGenerateAll": auto_generate_all,
                                "nextStage": next_stage(resolved_next_stage)
                                if auto_generate_all
                                else None,
                            },
                            ensure_ascii=False,
                        ),
                    ),
                )
                conn.execute(
                    """
                    update projects
                    set
                      current_stage = %s,
                      status = 'processing',
                      progress = %s,
                      updated_at = now()
                    where id = %s
                    """,
                    (
                        resolved_next_stage,
                        progress_for_stage(resolved_next_stage, completed=False),
                        project["id"],
                    ),
                )
            else:
                conn.execute(
                    """
                    update projects
                    set
                      current_stage = %s,
                      status = %s,
                      progress = %s,
                      updated_at = now()
                    where id = %s
                    """,
                    (
                        job["stage"],
                        "completed" if should_finish_course else "uploaded",
                        progress_for_stage(job["stage"], completed=should_finish_course),
                        project["id"],
                    ),
                )

        if next_job_payload:
            redis_command(
                config.redis_url,
                "LPUSH",
                config.job_queue_key,
                json.dumps(next_job_payload, ensure_ascii=False),
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
            conn.execute(
                """
                update projects
                set status = 'failed', updated_at = now()
                where id = %s
                """,
                (job_message["projectId"],),
            )
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
