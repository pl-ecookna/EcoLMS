from __future__ import annotations

import base64
import json
import os
import socket
import ssl
import subprocess
import tempfile
import time
from io import BytesIO
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import urlparse, unquote

import boto3
import psycopg
from docx import Document
from pptx import Presentation
from pypdf import PdfReader
from psycopg.rows import dict_row
from striprtf.striprtf import rtf_to_text

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
    meeting_job_queue_key: str = "ecolms:meeting-jobs"
    salutespeech_auth_key: str = ""
    salutespeech_oauth_url: str = ""
    salutespeech_rest_url: str = "https://smartspeech.sber.ru/rest/v1"
    salutespeech_scope: str = "SALUTE_SPEECH_PERS"
    salutespeech_model: str = "general"
    salutespeech_language: str = "ru-RU"
    salutespeech_poll_interval_seconds: float = 5.0
    salutespeech_timeout_seconds: float = 1800.0


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
        meeting_job_queue_key=os.getenv("WORKER_MEETING_JOB_QUEUE_KEY", "ecolms:meeting-jobs"),
        salutespeech_auth_key=os.getenv("SALUTESPEECH_AUTH_KEY", "").strip(),
        salutespeech_oauth_url=os.getenv("SALUTESPEECH_OAUTH_URL", "").strip(),
        salutespeech_rest_url=os.getenv(
            "SALUTESPEECH_REST_URL", "https://smartspeech.sber.ru/rest/v1"
        ).strip(),
        salutespeech_scope=os.getenv("SALUTESPEECH_SCOPE", "SALUTE_SPEECH_PERS").strip(),
        salutespeech_model=os.getenv("SALUTESPEECH_MODEL", "general").strip() or "general",
        salutespeech_language=os.getenv("SALUTESPEECH_LANGUAGE", "ru-RU").strip() or "ru-RU",
        salutespeech_poll_interval_seconds=float(
            os.getenv("SALUTESPEECH_POLL_INTERVAL_SECONDS", "5")
        ),
        salutespeech_timeout_seconds=float(
            os.getenv("SALUTESPEECH_TIMEOUT_SECONDS", "1800")
        ),
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
        return f"# {project_name}\n\n{topic}\n"

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


def make_source_compiled_markdown(project_name: str, sections: list[str]) -> str:
    clean_sections = [item.strip() for item in sections if item and item.strip()]
    if not clean_sections:
        return f"# {project_name}\n\nИсточник пуст. Добавьте файлы и запустите распознавание.\n"
    return f"# {project_name}\n\n" + "\n\n---\n\n".join(clean_sections)


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


def analyze_source_with_llm(
    config: WorkerConfig,
    source_text: str,
    *,
    prompt_key: str = "analize_video",
    source_type: str = "видео",
) -> dict[str, Any]:
    prompt_definition = PROMPTS.get(prompt_key)
    if prompt_definition is None:
        raise RuntimeError(f"Неизвестный prompt key: {prompt_key}")
    prompt = prompt_definition.text
    if not source_text.strip():
        raise RuntimeError("Невозможно вызвать LLM: исходный текст пуст.")

    user_payload = {
        "task": (
            f"Проанализируй {source_type} и верни только JSON с полями summary и transcript. "
            "Поле transcript должно содержать очищенный исходный текст без выдуманных данных."
        ),
        "sourceText": source_text,
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
            transcript = str(
                parsed.get("transcript")
                or parsed.get("sourceText")
                or parsed.get("text")
                or ""
            ).strip()
            if not summary:
                summary = extract_summary(source_text)
            if not transcript:
                transcript = source_text
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


def stage_input_stages(stage: str) -> list[str]:
    if stage == "course_outline":
        return ["source_compiled"]
    if stage == "course_content":
        return ["source_compiled", "course_outline"]
    if stage == "course_test":
        return ["source_compiled", "course_content"]
    return []


def build_stage_generation_input(
    conn: psycopg.Connection, project_id: str, stage: str, fallback_summary: str
) -> tuple[str, list[str]]:
    stages = stage_input_stages(stage)
    parts: list[str] = []
    used_stages: list[str] = []
    for source_stage in stages:
        markdown = load_artifact_markdown(conn, project_id, source_stage)
        if not markdown:
            continue
        parts.append(f"### {source_stage}\n{markdown}")
        used_stages.append(source_stage)
    if parts:
        return "\n\n".join(parts).strip(), used_stages
    return fallback_summary.strip(), used_stages


def generate_stage_markdown_with_llm(
    config: WorkerConfig,
    *,
    stage: str,
    source_text: str,
    project_name: str,
) -> dict[str, Any]:
    prompt_keys = [item.key for item in prompt_bundle_for_stage(stage)]
    prompt_key = next((key for key in prompt_keys if key.startswith("generate_")), None)
    if not prompt_key:
        raise RuntimeError(f"Для этапа {stage} не найден prompt генерации.")
    prompt = PROMPTS[prompt_key].text
    normalized_source = source_text.strip()
    if not normalized_source:
        raise RuntimeError(f"Невозможно вызвать LLM для {stage}: пустой источник.")

    user_payload = {
        "task": (
            "Сгенерируй итоговый markdown для этапа курса. "
            "Используй только данные из sourceText, без выдуманных деталей."
        ),
        "projectName": project_name,
        "stage": stage,
        "sourceText": normalized_source[:180000],
        "outputFormat": {"type": "json", "fields": ["markdown", "shortSummary"]},
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
            markdown = str(
                parsed.get("markdown") or parsed.get("content") or parsed.get("text") or ""
            ).strip()
            short_summary = str(parsed.get("shortSummary") or "").strip()
            if not markdown:
                raise RuntimeError("LLM вернул пустое поле markdown.")
            return {
                "markdown": markdown,
                "shortSummary": short_summary,
                "provider": provider,
                "model": model_name,
                "attempts": attempts + [{"provider": provider, "ok": True}],
                "sourceTextLength": len(normalized_source),
                "promptKey": prompt_key,
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
MEETING_STAGE_ORDER = [
    "audio_prepared",
    "transcript_compiled",
    "meeting_summary",
    "meeting_protocol",
    "meeting_actions",
]


def next_stage(stage: str) -> str | None:
    try:
        index = STAGE_ORDER.index(stage)
    except ValueError:
        return None
    return STAGE_ORDER[index + 1] if index + 1 < len(STAGE_ORDER) else None


def next_meeting_stage(stage: str) -> str | None:
    try:
        index = MEETING_STAGE_ORDER.index(stage)
    except ValueError:
        return None
    return (
        MEETING_STAGE_ORDER[index + 1]
        if index + 1 < len(MEETING_STAGE_ORDER)
        else None
    )


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


def load_artifact_markdown(conn: psycopg.Connection, project_id: str, stage: str) -> str:
    row = conn.execute(
        """
        select content_md
        from artifacts
        where project_id = %s and stage = %s and format = 'md'
        limit 1
        """,
        (project_id, stage),
    ).fetchone()
    if row is None:
        return ""
    content = row.get("content_md")
    if not isinstance(content, str):
        return ""
    return content.strip()


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


def file_extension(source_file: dict[str, Any]) -> str:
    name = str(source_file.get("original_name") or "").strip().lower()
    if "." not in name:
        return ""
    return name.rsplit(".", 1)[-1]


def is_document_source_file(source_file: dict[str, Any]) -> bool:
    mime_type = str(source_file.get("mime_type") or "").lower()
    kind = str(source_file.get("kind") or "").lower()
    ext = file_extension(source_file)
    if mime_type.startswith("video/") or kind == "video":
        return False
    if kind in {"document", "pdf", "presentation", "text"}:
        return True
    if mime_type.startswith("text/"):
        return True
    if mime_type in {
        "application/pdf",
        "application/rtf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }:
        return True
    return ext in {"pdf", "doc", "docx", "ppt", "pptx", "rtf", "txt", "md"}


def pick_document_source_files(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [source_file for source_file in files if is_document_source_file(source_file)]


def s3_client(config: WorkerConfig) -> Any:
    return boto3.client(
        "s3",
        endpoint_url=config.s3_endpoint,
        aws_access_key_id=config.s3_access_key_id,
        aws_secret_access_key=config.s3_secret_access_key,
        region_name=config.s3_region,
    )


def download_s3_object_bytes(config: WorkerConfig, storage_key: str) -> bytes:
    response = s3_client(config).get_object(Bucket=config.s3_bucket, Key=storage_key)
    body = response.get("Body")
    if body is None:
        raise RuntimeError("S3 вернул пустой body для source file.")
    content = body.read()
    if not isinstance(content, (bytes, bytearray)):
        raise RuntimeError("S3 вернул невалидный body для source file.")
    return bytes(content)


def extract_document_text(source_file: dict[str, Any], file_bytes: bytes) -> str:
    mime_type = str(source_file.get("mime_type") or "").lower()
    ext = file_extension(source_file)
    if mime_type == "application/pdf" or ext == "pdf":
        reader = PdfReader(BytesIO(file_bytes))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(item.strip() for item in pages if item.strip())
    if (
        mime_type
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        or ext == "docx"
    ):
        document = Document(BytesIO(file_bytes))
        paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs]
        return "\n".join(item for item in paragraphs if item)
    if (
        mime_type
        == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        or ext == "pptx"
        or mime_type == "application/vnd.ms-powerpoint"
        or ext == "ppt"
    ):
        presentation = Presentation(BytesIO(file_bytes))
        slides_text: list[str] = []
        for index, slide in enumerate(presentation.slides, start=1):
            fragments: list[str] = []
            for shape in slide.shapes:
                text = str(getattr(shape, "text", "") or "").strip()
                if text:
                    fragments.append(text)
            if fragments:
                slides_text.append(f"Слайд {index}:\n" + "\n".join(fragments))
        return "\n\n".join(slides_text)
    if mime_type == "application/rtf" or ext == "rtf":
        decoded = file_bytes.decode("utf-8", errors="ignore")
        return rtf_to_text(decoded).strip()
    return file_bytes.decode("utf-8", errors="ignore").strip()


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


def salutespeech_ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context()


def salutespeech_request(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    timeout: float = 60.0,
) -> dict[str, Any]:
    request = urlrequest.Request(
        url,
        method=method,
        data=data,
        headers=headers or {},
    )
    with urlrequest.urlopen(
        request,
        timeout=timeout,
        context=salutespeech_ssl_context(),
    ) as response:
        raw = response.read().decode("utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise RuntimeError("SaluteSpeech вернул невалидный JSON.")
    return payload


def get_salutespeech_access_token(config: WorkerConfig) -> str:
    if not config.salutespeech_auth_key:
        raise RuntimeError("SALUTESPEECH_AUTH_KEY не задан.")
    if not config.salutespeech_oauth_url:
        raise RuntimeError("SALUTESPEECH_OAUTH_URL не задан.")

    data = f"scope={config.salutespeech_scope}".encode("utf-8")
    payload = salutespeech_request(
        config.salutespeech_oauth_url,
        method="POST",
        data=data,
        headers={
            "Authorization": f"Basic {config.salutespeech_auth_key}",
            "RqUID": f"ecolms-{int(time.time() * 1000)}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout=30.0,
    )
    token = str(
        payload.get("access_token")
        or payload.get("result", {}).get("access_token")
        or ""
    ).strip()
    if not token:
        raise RuntimeError("SaluteSpeech не вернул access token.")
    return token


def encode_multipart_form(field_name: str, file_name: str, content: bytes) -> tuple[bytes, str]:
    boundary = f"----ecolms-boundary-{int(time.time() * 1000)}"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{file_name}"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("utf-8")
    return body, boundary


def salutespeech_upload_file(
    config: WorkerConfig, token: str, file_name: str, content: bytes
) -> str:
    body, boundary = encode_multipart_form("file", file_name, content)
    payload = salutespeech_request(
        f"{config.salutespeech_rest_url.rstrip('/')}/data:upload",
        method="POST",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        timeout=120.0,
    )
    request_file_id = str(
        payload.get("result", {}).get("request_file_id")
        or payload.get("request_file_id")
        or ""
    ).strip()
    if not request_file_id:
        raise RuntimeError("SaluteSpeech не вернул request_file_id.")
    return request_file_id


def salutespeech_create_recognition_task(
    config: WorkerConfig,
    token: str,
    *,
    request_file_id: str,
    sample_rate: int,
    channels_count: int,
) -> str:
    payload = salutespeech_request(
        f"{config.salutespeech_rest_url.rstrip('/')}/speech:async_recognize",
        method="POST",
        data=json.dumps(
            {
                "request_file_id": request_file_id,
                "options": {
                    "model": config.salutespeech_model,
                    "language": config.salutespeech_language,
                    "audio_encoding": "PCM_S16LE",
                    "sample_rate": sample_rate,
                    "channels_count": channels_count,
                    "speaker_info": True,
                },
            },
            ensure_ascii=False,
        ).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
        timeout=60.0,
    )
    task_id = str(payload.get("result", {}).get("id") or payload.get("id") or "").strip()
    if not task_id:
        raise RuntimeError("SaluteSpeech не вернул id задачи распознавания.")
    return task_id


def salutespeech_get_task_status(config: WorkerConfig, token: str, task_id: str) -> dict[str, Any]:
    return salutespeech_request(
        f"{config.salutespeech_rest_url.rstrip('/')}/task:get?id={task_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30.0,
    )


def salutespeech_download_result(
    config: WorkerConfig, token: str, response_file_id: str
) -> dict[str, Any]:
    return salutespeech_request(
        f"{config.salutespeech_rest_url.rstrip('/')}/data:download?response_file_id={response_file_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=120.0,
    )


def extract_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def to_milliseconds(value: Any) -> int | None:
    number = extract_float(value)
    if number is None:
        return None
    if number > 10_000:
        return int(number)
    return int(number * 1000)


def collect_segment_candidates(value: Any, results: list[dict[str, Any]]) -> None:
    if isinstance(value, dict):
        has_speaker = "speaker_id" in value
        has_text = isinstance(value.get("text"), str) and value.get("text", "").strip()
        has_word = isinstance(value.get("word"), str) and value.get("word", "").strip()
        if has_speaker and (has_text or has_word):
            results.append(value)
        for nested in value.values():
            collect_segment_candidates(nested, results)
    elif isinstance(value, list):
        for item in value:
            collect_segment_candidates(item, results)


def parse_salutespeech_segments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    collect_segment_candidates(payload, candidates)
    segment_like: list[dict[str, Any]] = []
    word_like: list[dict[str, Any]] = []

    for item in candidates:
        speaker_id = int(item.get("speaker_id", -1))
        if speaker_id < 0:
            continue

        if isinstance(item.get("text"), str) and item.get("text", "").strip():
            start_ms = (
                to_milliseconds(item.get("start_ms"))
                or to_milliseconds(item.get("start"))
                or to_milliseconds(item.get("start_time"))
            )
            end_ms = (
                to_milliseconds(item.get("end_ms"))
                or to_milliseconds(item.get("end"))
                or to_milliseconds(item.get("end_time"))
            )
            if start_ms is None or end_ms is None or end_ms < start_ms:
                continue
            segment_like.append(
                {
                    "speaker_id": speaker_id,
                    "text": str(item.get("text")).strip(),
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "confidence": extract_float(item.get("confidence")),
                    "provider_payload_json": item,
                }
            )
        elif isinstance(item.get("word"), str) and item.get("word", "").strip():
            start_ms = (
                to_milliseconds(item.get("start_ms"))
                or to_milliseconds(item.get("start"))
                or to_milliseconds(item.get("start_time"))
            )
            end_ms = (
                to_milliseconds(item.get("end_ms"))
                or to_milliseconds(item.get("end"))
                or to_milliseconds(item.get("end_time"))
            )
            if start_ms is None or end_ms is None or end_ms < start_ms:
                continue
            word_like.append(
                {
                    "speaker_id": speaker_id,
                    "word": str(item.get("word")).strip(),
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "confidence": extract_float(item.get("confidence")),
                    "provider_payload_json": item,
                }
            )

    if segment_like:
        segment_like.sort(key=lambda item: (item["start_ms"], item["end_ms"]))
        return segment_like

    if not word_like:
        raise RuntimeError("SaluteSpeech не вернул diarized segments со speaker_id.")

    word_like.sort(key=lambda item: (item["start_ms"], item["end_ms"]))
    merged: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for word in word_like:
        if current is None:
            current = {
                "speaker_id": word["speaker_id"],
                "text": word["word"],
                "start_ms": word["start_ms"],
                "end_ms": word["end_ms"],
                "confidence_values": [word.get("confidence")],
                "provider_items": [word["provider_payload_json"]],
            }
            continue
        gap = int(word["start_ms"]) - int(current["end_ms"])
        if (
            int(word["speaker_id"]) == int(current["speaker_id"])
            and gap <= 1200
        ):
            current["text"] = f"{current['text']} {word['word']}".strip()
            current["end_ms"] = word["end_ms"]
            current["confidence_values"].append(word.get("confidence"))
            current["provider_items"].append(word["provider_payload_json"])
            continue
        confidences = [value for value in current["confidence_values"] if value is not None]
        merged.append(
            {
                "speaker_id": current["speaker_id"],
                "text": current["text"].strip(),
                "start_ms": current["start_ms"],
                "end_ms": current["end_ms"],
                "confidence": round(sum(confidences) / len(confidences), 4)
                if confidences
                else None,
                "provider_payload_json": {"words": current["provider_items"]},
            }
        )
        current = {
            "speaker_id": word["speaker_id"],
            "text": word["word"],
            "start_ms": word["start_ms"],
            "end_ms": word["end_ms"],
            "confidence_values": [word.get("confidence")],
            "provider_items": [word["provider_payload_json"]],
        }

    if current is not None:
        confidences = [value for value in current["confidence_values"] if value is not None]
        merged.append(
            {
                "speaker_id": current["speaker_id"],
                "text": current["text"].strip(),
                "start_ms": current["start_ms"],
                "end_ms": current["end_ms"],
                "confidence": round(sum(confidences) / len(confidences), 4)
                if confidences
                else None,
                "provider_payload_json": {"words": current["provider_items"]},
            }
        )

    return merged


def format_ms_range(start_ms: int, end_ms: int) -> str:
    def one(value: int) -> str:
        seconds_total = max(0, value // 1000)
        hours = seconds_total // 3600
        minutes = (seconds_total % 3600) // 60
        seconds = seconds_total % 60
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    return f"{one(start_ms)} - {one(end_ms)}"


def build_meeting_transcript_markdown(title: str, segments: list[dict[str, Any]]) -> str:
    lines = [f"# {title}", ""]
    for segment in segments:
        lines.append(
            f"## [{format_ms_range(int(segment['start_ms']), int(segment['end_ms']))}] {segment['display_name']}"
        )
        lines.append(str(segment["text"]).strip())
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def build_meeting_transcript_json(
    meeting_id: str,
    speakers: list[dict[str, Any]],
    segments: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "meetingId": meeting_id,
        "speakers": [
            {
                "id": item["id"],
                "speakerLabel": item["speaker_label"],
                "displayName": item["display_name"],
                "isUserEdited": bool(item["is_user_edited"]),
                "sortOrder": int(item["sort_order"]),
            }
            for item in speakers
        ],
        "segments": [
            {
                "id": int(item["id"]),
                "speakerId": item["speaker_id"],
                "speakerLabel": item["speaker_label"],
                "displayName": item["display_name"],
                "startMs": int(item["start_ms"]),
                "endMs": int(item["end_ms"]),
                "text": str(item["text"]),
                "confidence": item["confidence"],
            }
            for item in segments
        ],
    }


def build_meeting_llm_transcript_input(segments: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for segment in segments:
        parts.append(
            "\n".join(
                [
                    f"[segment_id={segment['id']}]",
                    f"[{format_ms_range(int(segment['start_ms']), int(segment['end_ms']))}] {segment['display_name']}",
                    str(segment["text"]).strip(),
                ]
            )
        )
    return "\n\n".join(parts).strip()


def generate_meeting_markdown_with_llm(
    config: WorkerConfig,
    *,
    stage: str,
    meeting_title: str,
    transcript_input: str,
) -> dict[str, Any]:
    if not transcript_input.strip():
        raise RuntimeError(f"Невозможно вызвать LLM для {stage}: пустой transcript.")

    if stage == "meeting_summary":
        task = (
            "Сформируй краткое summary встречи на русском языке. "
            "Верни только JSON с полями markdown и shortSummary. "
            "Используй только данные из transcript, ничего не выдумывай."
        )
    elif stage == "meeting_protocol":
        task = (
            "Сформируй протокол встречи на русском языке. "
            "Верни только JSON с полями markdown и shortSummary. "
            "Используй только данные из transcript, ничего не выдумывай."
        )
    else:
        task = (
            "Сформируй структурированные результаты встречи на русском языке. "
            "Верни только JSON с полями markdown, shortSummary, decisions, actionItems, openQuestions. "
            "Для actionItems указывай assignee и deadline только если они явно прозвучали. "
            "Для actionItems по возможности указывай sourceSegmentIds как массив segment_id из transcript."
        )

    user_payload = {
        "meetingTitle": meeting_title,
        "stage": stage,
        "task": task,
        "transcript": transcript_input[:180000],
    }
    messages = [
        {
            "role": "system",
            "content": (
                "Ты анализируешь русскоязычные встречи. "
                "Используй только факты из transcript. "
                "Не придумывай имена, сроки, решения и поручения, которых нет в тексте."
            ),
        },
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
            markdown = str(parsed.get("markdown") or "").strip()
            short_summary = str(parsed.get("shortSummary") or "").strip()
            if not markdown:
                raise RuntimeError("LLM вернул пустое поле markdown.")
            return {
                **parsed,
                "markdown": markdown,
                "shortSummary": short_summary,
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


def meeting_actions_json_from_llm(result: dict[str, Any], markdown: str) -> dict[str, Any]:
    decisions = result.get("decisions")
    action_items = result.get("actionItems")
    open_questions = result.get("openQuestions")
    return {
        "decisions": decisions if isinstance(decisions, list) else [],
        "actionItems": action_items if isinstance(action_items, list) else [],
        "openQuestions": open_questions if isinstance(open_questions, list) else [],
        "markdown": markdown,
    }


def load_meeting(conn: psycopg.Connection, meeting_id: str) -> dict[str, Any]:
    row = conn.execute(
        "select * from meetings where id = %s limit 1",
        (meeting_id,),
    ).fetchone()
    if row is None:
        raise RuntimeError(f"Meeting not found: {meeting_id}")
    return dict(row)


def load_meeting_job(conn: psycopg.Connection, job_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "select * from meeting_jobs where id = %s limit 1",
        (job_id,),
    ).fetchone()
    return dict(row) if row else None


def load_meeting_source_file(conn: psycopg.Connection, meeting_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        """
        select *
        from meeting_source_files
        where meeting_id = %s
        limit 1
        """,
        (meeting_id,),
    ).fetchone()
    return dict(row) if row else None


def set_meeting_job_processing(conn: psycopg.Connection, job_id: str) -> None:
    conn.execute(
        """
        update meeting_jobs
        set status = 'processing', started_at = now(), error_text = null
        where id = %s
        """,
        (job_id,),
    )


def set_meeting_job_done(
    conn: psycopg.Connection, job_id: str, stage: str, metadata: dict[str, Any]
) -> None:
    conn.execute(
        """
        update meeting_jobs
        set status = 'done',
            result_json = %s::jsonb,
            finished_at = now()
        where id = %s
        """,
        (
            json.dumps(
                {"status": "done", "stage": stage, "generatedAt": utc_now(), **metadata},
                ensure_ascii=False,
            ),
            job_id,
        ),
    )


def set_meeting_job_failed(conn: psycopg.Connection, job_id: str, error_text: str) -> None:
    conn.execute(
        """
        update meeting_jobs
        set status = 'failed',
            error_text = %s,
            finished_at = now()
        where id = %s
        """,
        (error_text, job_id),
    )


def ensure_meeting_artifact(
    conn: psycopg.Connection,
    meeting_id: str,
    stage: str,
    markdown: str,
    content_json: dict[str, Any],
) -> None:
    conn.execute(
        """
        update meeting_artifacts
        set content_md = %s,
            updated_at = now()
        where meeting_id = %s and stage = %s and format = 'md'
        """,
        (markdown, meeting_id, stage),
    )
    conn.execute(
        """
        update meeting_artifacts
        set content_json = %s::jsonb,
            updated_at = now()
        where meeting_id = %s and stage = %s and format = 'json'
        """,
        (json.dumps(content_json, ensure_ascii=False), meeting_id, stage),
    )


def load_meeting_artifact(
    conn: psycopg.Connection, meeting_id: str, stage: str, format_name: str
) -> dict[str, Any] | None:
    row = conn.execute(
        """
        select *
        from meeting_artifacts
        where meeting_id = %s and stage = %s and format = %s
        limit 1
        """,
        (meeting_id, stage, format_name),
    ).fetchone()
    return dict(row) if row else None


def load_meeting_speakers(conn: psycopg.Connection, meeting_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        select *
        from meeting_speakers
        where meeting_id = %s
        order by sort_order asc, created_at asc
        """,
        (meeting_id,),
    ).fetchall()
    return [dict(item) for item in rows]


def load_meeting_segments(conn: psycopg.Connection, meeting_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        select *
        from meeting_speaker_segments
        where meeting_id = %s
        order by start_ms asc, id asc
        """,
        (meeting_id,),
    ).fetchall()
    return [dict(item) for item in rows]


def clear_meeting_transcript(conn: psycopg.Connection, meeting_id: str) -> None:
    conn.execute("delete from meeting_speaker_segments where meeting_id = %s", (meeting_id,))
    conn.execute("delete from meeting_speakers where meeting_id = %s", (meeting_id,))


def upsert_meeting_transcript(
    conn: psycopg.Connection, meeting_id: str, raw_segments: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    clear_meeting_transcript(conn, meeting_id)
    speaker_map: dict[int, dict[str, Any]] = {}
    sort_order = 0
    for segment in raw_segments:
        speaker_key = int(segment["speaker_id"])
        if speaker_key in speaker_map:
            continue
        sort_order += 1
        speaker_id = f"{meeting_id}-speaker-{speaker_key}"
        speaker = {
            "id": speaker_id,
            "meeting_id": meeting_id,
            "speaker_label": f"speaker_{speaker_key}",
            "display_name": f"Спикер {sort_order}",
            "is_user_edited": False,
            "sort_order": sort_order,
        }
        speaker_map[speaker_key] = speaker
        conn.execute(
            """
            insert into meeting_speakers (
              id, meeting_id, speaker_label, display_name, is_user_edited, sort_order, created_at, updated_at
            ) values (
              %s, %s, %s, %s, %s, %s, now(), now()
            )
            """,
            (
                speaker["id"],
                speaker["meeting_id"],
                speaker["speaker_label"],
                speaker["display_name"],
                speaker["is_user_edited"],
                speaker["sort_order"],
            ),
        )

    inserted_segments: list[dict[str, Any]] = []
    for segment in raw_segments:
        speaker = speaker_map[int(segment["speaker_id"])]
        row = conn.execute(
            """
            insert into meeting_speaker_segments (
              meeting_id, speaker_id, speaker_label, start_ms, end_ms, text, confidence, provider_payload_json, created_at
            ) values (
              %s, %s, %s, %s, %s, %s, %s, %s::jsonb, now()
            )
            returning *
            """,
            (
                meeting_id,
                speaker["id"],
                speaker["speaker_label"],
                int(segment["start_ms"]),
                int(segment["end_ms"]),
                str(segment["text"]).strip(),
                segment.get("confidence"),
                json.dumps(segment.get("provider_payload_json") or {}, ensure_ascii=False),
            ),
        ).fetchone()
        if row is not None:
            inserted = dict(row)
            inserted["display_name"] = speaker["display_name"]
            inserted_segments.append(inserted)

    speakers = list(speaker_map.values())
    return speakers, inserted_segments


def ffprobe_audio_details(source_path: str) -> tuple[int, int, float]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=channels",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            source_path,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"ffprobe failed: {(result.stderr or result.stdout or '').strip()}"
        )
    payload = json.loads(result.stdout or "{}")
    channels = int(
        payload.get("streams", [{}])[0].get("channels") or 1
    )
    duration = float(payload.get("format", {}).get("duration") or 0.0)
    target_channels = 2 if channels > 1 else 1
    return channels, target_channels, duration


def upload_s3_object_bytes(
    config: WorkerConfig, storage_key: str, content: bytes, content_type: str
) -> None:
    s3_client(config).put_object(
        Bucket=config.s3_bucket,
        Key=storage_key,
        Body=content,
        ContentType=content_type,
    )


def prepare_meeting_audio(
    config: WorkerConfig, source_file: dict[str, Any]
) -> dict[str, Any]:
    source_bytes = download_s3_object_bytes(config, str(source_file["storage_key"]))
    source_suffix = "." + file_extension(source_file) if file_extension(source_file) else ".bin"
    with tempfile.NamedTemporaryFile(suffix=source_suffix, delete=False) as src:
        src.write(source_bytes)
        source_path = src.name
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as out:
        output_path = out.name

    try:
        _, target_channels, duration = ffprobe_audio_details(source_path)
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            source_path,
            "-vn",
            "-ac",
            str(target_channels),
            "-ar",
            "16000",
            "-f",
            "wav",
            output_path,
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            details = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(f"FFmpeg audio preparation failed: {details or 'unknown error'}")
        with open(output_path, "rb") as file:
            audio_bytes = file.read()
        audio_storage_key = f"meetings/{source_file['meeting_id']}/derived/prepared-audio.wav"
        upload_s3_object_bytes(
            config,
            audio_storage_key,
            audio_bytes,
            "audio/x-wav",
        )
        return {
            "audio_storage_key": audio_storage_key,
            "audio_mime_type": "audio/x-wav",
            "duration_seconds": int(round(duration)) if duration > 0 else None,
            "sample_rate": 16000,
            "channels_count": target_channels,
            "audio_bytes": audio_bytes,
            "file_name": "prepared-audio.wav",
        }
    finally:
        try:
            os.unlink(source_path)
        except OSError:
            pass
        try:
            os.unlink(output_path)
        except OSError:
            pass


def transcribe_meeting_with_salutespeech(
    config: WorkerConfig,
    prepared_audio: dict[str, Any],
) -> dict[str, Any]:
    token = get_salutespeech_access_token(config)
    request_file_id = salutespeech_upload_file(
        config,
        token,
        str(prepared_audio["file_name"]),
        prepared_audio["audio_bytes"],
    )
    task_id = salutespeech_create_recognition_task(
        config,
        token,
        request_file_id=request_file_id,
        sample_rate=int(prepared_audio["sample_rate"]),
        channels_count=int(prepared_audio["channels_count"]),
    )

    started_at = time.time()
    last_status_payload: dict[str, Any] | None = None
    while True:
        status_payload = salutespeech_get_task_status(config, token, task_id)
        last_status_payload = status_payload
        result = status_payload.get("result") or {}
        status = str(result.get("status") or "").upper()
        if status == "DONE":
            response_file_id = str(result.get("response_file_id") or "").strip()
            if not response_file_id:
                raise RuntimeError("SaluteSpeech вернул DONE без response_file_id.")
            result_payload = salutespeech_download_result(config, token, response_file_id)
            return {
                "task_id": task_id,
                "request_file_id": request_file_id,
                "response_file_id": response_file_id,
                "status_payload": status_payload,
                "result_payload": result_payload,
            }
        if status == "ERROR":
            raise RuntimeError(str(result.get("error") or "SaluteSpeech task failed"))
        if time.time() - started_at > config.salutespeech_timeout_seconds:
            raise RuntimeError("SaluteSpeech task timed out")
        time.sleep(max(1.0, config.salutespeech_poll_interval_seconds))


def handle_meeting_audio_prepared(
    conn: psycopg.Connection,
    config: WorkerConfig,
    meeting: dict[str, Any],
    source_file: dict[str, Any],
) -> dict[str, Any]:
    prepared = prepare_meeting_audio(config, source_file)
    conn.execute(
        """
        update meeting_source_files
        set
          audio_storage_key = %s,
          audio_mime_type = %s,
          duration_seconds = %s,
          processing_status = 'done'
        where id = %s
        """,
        (
            prepared["audio_storage_key"],
            prepared["audio_mime_type"],
            prepared["duration_seconds"],
            source_file["id"],
        ),
    )
    conn.execute(
        """
        update meetings
        set
          duration_seconds = %s,
          updated_at = now()
        where id = %s
        """,
        (prepared["duration_seconds"], meeting["id"]),
    )
    return {
        "audioStorageKey": prepared["audio_storage_key"],
        "audioMimeType": prepared["audio_mime_type"],
        "durationSeconds": prepared["duration_seconds"],
        "sampleRate": prepared["sample_rate"],
        "channelsCount": prepared["channels_count"],
    }


def handle_meeting_transcript_compiled(
    conn: psycopg.Connection,
    config: WorkerConfig,
    meeting: dict[str, Any],
    source_file: dict[str, Any],
) -> dict[str, Any]:
    prepared = prepare_meeting_audio(config, source_file)
    raw_result = transcribe_meeting_with_salutespeech(config, prepared)
    diarized_segments = parse_salutespeech_segments(
        raw_result["result_payload"]
    )
    speakers, segments = upsert_meeting_transcript(conn, meeting["id"], diarized_segments)
    transcript_markdown = build_meeting_transcript_markdown(
        str(meeting["title"]),
        segments,
    )
    transcript_json = build_meeting_transcript_json(meeting["id"], speakers, segments)

    ensure_meeting_artifact(
        conn,
        meeting["id"],
        "transcript_compiled",
        transcript_markdown,
        transcript_json,
    )
    conn.execute(
        """
        update meeting_source_files
        set
          audio_storage_key = %s,
          audio_mime_type = %s,
          duration_seconds = %s,
          processing_status = 'done'
        where id = %s
        """,
        (
            prepared["audio_storage_key"],
            prepared["audio_mime_type"],
            prepared["duration_seconds"],
            source_file["id"],
        ),
    )
    conn.execute(
        """
        update meetings
        set
          duration_seconds = %s,
          speakers_count = %s,
          updated_at = now()
        where id = %s
        """,
        (prepared["duration_seconds"], len(speakers), meeting["id"]),
    )
    return {
        "provider": "salutespeech",
        "model": config.salutespeech_model,
        "language": config.salutespeech_language,
        "speakerSeparation": True,
        "audioStorageKey": prepared["audio_storage_key"],
        "sampleRate": prepared["sample_rate"],
        "channelsCount": prepared["channels_count"],
        "durationSeconds": prepared["duration_seconds"],
        "speakersCount": len(speakers),
        "segmentsCount": len(segments),
        "salutespeech": raw_result,
    }


def handle_meeting_generation_stage(
    conn: psycopg.Connection,
    config: WorkerConfig,
    meeting: dict[str, Any],
    stage: str,
) -> dict[str, Any]:
    transcript_json_artifact = load_meeting_artifact(conn, meeting["id"], "transcript_compiled", "json")
    if transcript_json_artifact is None:
        raise RuntimeError("Transcript artifact not found for meeting generation.")
    transcript_payload = transcript_json_artifact.get("content_json") or {}
    transcript_data = parse_json(transcript_payload, {})
    speakers = transcript_data.get("speakers")
    segments = transcript_data.get("segments")
    if not isinstance(segments, list) or not segments:
        raise RuntimeError("Transcript JSON не содержит segments.")

    normalized_segments: list[dict[str, Any]] = []
    speakers_by_id: dict[str, dict[str, Any]] = {}
    if isinstance(speakers, list):
        for speaker in speakers:
            if isinstance(speaker, dict):
                speakers_by_id[str(speaker.get("id") or "")] = speaker

    for segment in segments:
        if not isinstance(segment, dict):
            continue
        speaker_id = str(segment.get("speakerId") or "")
        display_name = str(segment.get("displayName") or "").strip()
        if not display_name and speaker_id:
            display_name = str(speakers_by_id.get(speaker_id, {}).get("displayName") or "").strip()
        normalized_segments.append(
            {
                "id": int(segment.get("id") or 0),
                "speaker_id": speaker_id or None,
                "speaker_label": str(segment.get("speakerLabel") or ""),
                "display_name": display_name or "Спикер",
                "start_ms": int(segment.get("startMs") or 0),
                "end_ms": int(segment.get("endMs") or 0),
                "text": str(segment.get("text") or "").strip(),
                "confidence": segment.get("confidence"),
            }
        )

    transcript_input = build_meeting_llm_transcript_input(normalized_segments)
    llm_result = generate_meeting_markdown_with_llm(
        config,
        stage=stage,
        meeting_title=str(meeting["title"]),
        transcript_input=transcript_input,
    )
    markdown = str(llm_result.get("markdown") or "").strip()
    if stage == "meeting_actions":
        content_json = meeting_actions_json_from_llm(llm_result, markdown)
    else:
        content_json = {
            "stage": stage,
            "markdown": markdown,
            "shortSummary": str(llm_result.get("shortSummary") or "").strip(),
        }

    ensure_meeting_artifact(conn, meeting["id"], stage, markdown, content_json)
    return {
        "llm": {
            "provider": llm_result.get("provider"),
            "model": llm_result.get("model"),
            "attempts": llm_result.get("attempts"),
        },
        "markdownLength": len(markdown),
        "transcriptSegments": len(normalized_segments),
    }


def queue_next_meeting_job(
    conn: psycopg.Connection,
    config: WorkerConfig,
    meeting_id: str,
    stage: str,
) -> dict[str, Any] | None:
    next_stage_value = next_meeting_stage(stage)
    if not next_stage_value:
        return None
    next_job_id = f"{meeting_id}-{next_stage_value}-{int(time.time() * 1000)}"
    conn.execute(
        """
        insert into meeting_jobs (
          id, meeting_id, stage, status, payload_json, result_json, error_text, started_at, finished_at, created_at
        ) values (
          %s, %s, %s, 'queued', %s::jsonb, null, null, null, null, now()
        )
        """,
        (
            next_job_id,
            meeting_id,
            next_stage_value,
            json.dumps({"stage": next_stage_value, "trigger": "manual"}, ensure_ascii=False),
        ),
    )
    return {
        "jobId": next_job_id,
        "meetingId": meeting_id,
        "stage": next_stage_value,
        "trigger": "manual",
    }


def process_meeting_job(config: WorkerConfig, job_message: dict[str, Any]) -> None:
    conn = psycopg.connect(config.postgres_url, row_factory=dict_row, autocommit=True)
    try:
        job = load_meeting_job(conn, job_message["jobId"])
        if job is None:
            print(
                json.dumps(
                    {
                        "service": "worker",
                        "status": "skipped",
                        "reason": "meeting-job-missing",
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
                        "reason": "meeting-job-already-done",
                        "jobId": job_message["jobId"],
                    },
                    ensure_ascii=False,
                )
            )
            return

        meeting = load_meeting(conn, job["meeting_id"])
        source_file = load_meeting_source_file(conn, meeting["id"])
        if source_file is None:
            raise RuntimeError("Meeting source file not found.")

        metadata: dict[str, Any]
        next_job_payload: dict[str, Any] | None = None

        with conn.transaction():
            set_meeting_job_processing(conn, job["id"])
            conn.execute(
                """
                update meeting_source_files
                set processing_status = 'processing'
                where id = %s
                """,
                (source_file["id"],),
            )
            conn.execute(
                """
                update meetings
                set
                  status = 'processing',
                  processing_started_at = coalesce(processing_started_at, now()),
                  processing_finished_at = null,
                  error_text = null,
                  updated_at = now()
                where id = %s
                """,
                (meeting["id"],),
            )

            if job["stage"] == "audio_prepared":
                metadata = handle_meeting_audio_prepared(conn, config, meeting, source_file)
            elif job["stage"] == "transcript_compiled":
                metadata = handle_meeting_transcript_compiled(conn, config, meeting, source_file)
            else:
                metadata = handle_meeting_generation_stage(conn, config, meeting, job["stage"])

            set_meeting_job_done(conn, job["id"], job["stage"], metadata)
            next_job_payload = queue_next_meeting_job(conn, config, meeting["id"], job["stage"])

            if next_job_payload is None:
                conn.execute(
                    """
                    update meetings
                    set
                      status = 'completed',
                      processing_finished_at = now(),
                      updated_at = now()
                    where id = %s
                    """,
                    (meeting["id"],),
                )

        if next_job_payload is not None:
            redis_command(
                config.redis_url,
                "LPUSH",
                config.meeting_job_queue_key,
                json.dumps(next_job_payload, ensure_ascii=False),
            )

        print(
            json.dumps(
                {
                    "service": "worker",
                    "status": "done",
                    "jobType": "meeting",
                    "jobId": job["id"],
                    "meetingId": meeting["id"],
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
            set_meeting_job_failed(conn, job_message["jobId"], str(exc))
            conn.execute(
                """
                update meetings
                set
                  status = 'failed',
                  error_text = %s,
                  updated_at = now()
                where id = %s
                """,
                (str(exc), job_message["meetingId"]),
            )
            conn.execute(
                """
                update meeting_source_files
                set processing_status = 'failed'
                where meeting_id = %s
                """,
                (job_message["meetingId"],),
            )
            conn.commit()
        except Exception:
            pass
        print(
            json.dumps(
                {
                    "service": "worker",
                    "status": "failed",
                    "jobType": "meeting",
                    "error": str(exc),
                },
                ensure_ascii=False,
            )
        )
    finally:
        conn.close()


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
        llm_stage_data: dict[str, Any] | None = None
        llm_documents: list[dict[str, Any]] = []
        llm_stage_input_stages: list[str] = []
        source_file: dict[str, Any] | None = None
        source_compiled_sections: list[str] = []
        topic_for_markdown = project["source_summary"]
        if job["stage"] == "source_compiled":
            source_files = load_source_files(conn, project["id"])
            source_file = pick_video_source_file(source_files)
            document_source_files = pick_document_source_files(source_files)
            if source_file is not None:
                transcription_data = call_transcription_service(config, source_file)
                transcript_text = str(transcription_data.get("text") or "").strip()
                llm_data = analyze_source_with_llm(
                    config,
                    transcript_text,
                    prompt_key="analize_video",
                    source_type="транскрипт видео",
                )
                video_source_text = str(llm_data.get("transcript") or "").strip() or transcript_text
                if video_source_text:
                    source_compiled_sections.append(
                        "\n".join(
                            [
                                f"## Видео: {source_file.get('original_name') or source_file['id']}",
                                video_source_text,
                            ]
                        )
                    )
                video_summary = str(llm_data.get("summary") or "").strip() or extract_summary(
                    video_source_text
                )
                if video_summary:
                    topic_for_markdown = video_summary
            if document_source_files:
                merged_document_parts: list[str] = []
                for document_source in document_source_files:
                    try:
                        document_bytes = download_s3_object_bytes(
                            config, str(document_source["storage_key"])
                        )
                        document_text = extract_document_text(document_source, document_bytes)
                        document_text = document_text.strip()
                        if not document_text:
                            continue
                        source_compiled_sections.append(
                            "\n".join(
                                [
                                    f"## Документ: {document_source.get('original_name') or document_source['id']}",
                                    document_text,
                                ]
                            )
                        )
                        merged_document_parts.append(
                            "\n\n".join(
                                [
                                    f"Файл: {document_source.get('original_name') or document_source['id']}",
                                    document_text[:50000],
                                ]
                            )
                        )
                    except Exception as exc:
                        llm_documents.append(
                            {
                                "fileId": document_source["id"],
                                "sourceOriginalName": document_source.get("original_name"),
                                "error": str(exc),
                            }
                        )
                if merged_document_parts:
                    merged_document_text = "\n\n---\n\n".join(merged_document_parts)[:180000]
                    llm_document_data = analyze_source_with_llm(
                        config,
                        merged_document_text,
                        prompt_key="analize_doc",
                        source_type="структурированные документы",
                    )
                    llm_documents.append(
                        {
                            "provider": llm_document_data.get("provider"),
                            "model": llm_document_data.get("model"),
                            "attempts": llm_document_data.get("attempts"),
                            "summaryLength": len(str(llm_document_data.get("summary") or "")),
                            "sourceTextLength": len(
                                str(llm_document_data.get("transcript") or "")
                            ),
                            "files": [
                                {
                                    "fileId": item["id"],
                                    "sourceStorageKey": item.get("storage_key"),
                                    "sourceOriginalName": item.get("original_name"),
                                    "sourceMimeType": item.get("mime_type"),
                                }
                                for item in document_source_files
                            ],
                        }
                    )
                    document_summary = str(llm_document_data.get("summary") or "").strip()
                    if document_summary:
                        topic_for_markdown = (
                            f"{topic_for_markdown}\n\n{document_summary}"
                            if topic_for_markdown.strip()
                            else document_summary
                        )
        else:
            source_for_stage, llm_stage_input_stages = build_stage_generation_input(
                conn,
                project["id"],
                job["stage"],
                str(project.get("source_summary") or ""),
            )
            if source_for_stage.strip():
                llm_stage_data = generate_stage_markdown_with_llm(
                    config,
                    stage=job["stage"],
                    source_text=source_for_stage,
                    project_name=str(project["name"]),
                )
                topic_for_markdown = (
                    str(llm_stage_data.get("shortSummary") or "").strip()
                    or extract_summary(source_for_stage)
                )

        markdown = str(llm_stage_data.get("markdown") or "").strip() if llm_stage_data else ""
        if job["stage"] == "source_compiled":
            markdown = make_source_compiled_markdown(project["name"], source_compiled_sections)
        if not markdown:
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
                "sourceTextLength": len(str(llm_data.get("transcript") or "")),
            }
        if llm_documents:
            stage_metadata["llmDocuments"] = llm_documents
        if llm_stage_data is not None:
            stage_metadata["llmStageGeneration"] = {
                "provider": llm_stage_data.get("provider"),
                "model": llm_stage_data.get("model"),
                "attempts": llm_stage_data.get("attempts"),
                "promptKey": llm_stage_data.get("promptKey"),
                "sourceTextLength": llm_stage_data.get("sourceTextLength"),
                "inputStages": llm_stage_input_stages,
                "markdownLength": len(str(llm_stage_data.get("markdown") or "")),
                "shortSummaryLength": len(str(llm_stage_data.get("shortSummary") or "")),
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
            {
                "service": "worker",
                "config": asdict(config),
                "queues": [config.job_queue_key, config.meeting_job_queue_key],
            },
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
                config.meeting_job_queue_key,
                "5",
                timeout=6,
            )
            if not raw_message:
                print(json.dumps({"service": "worker", "status": "heartbeat"}, ensure_ascii=False))
                continue

            queue_name = config.job_queue_key
            if isinstance(raw_message, list):
                queue_name = str(raw_message[0])
                raw_message = raw_message[-1]

            message = json.loads(raw_message)
            if queue_name == config.meeting_job_queue_key:
                process_meeting_job(config, message)
            else:
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
