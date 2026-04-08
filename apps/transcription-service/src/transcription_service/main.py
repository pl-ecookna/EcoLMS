from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import urlopen

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from faster_whisper import WhisperModel


@dataclass(slots=True)
class SourcePayload:
    bucket: str
    key: str
    source_url: str | None = None
    source_path: str | None = None


_MODEL: WhisperModel | None = None


def _env(name: str, fallback: str = "") -> str:
    return (os.getenv(name) or fallback).strip()


def _build_s3_client(overrides: dict[str, Any] | None) -> BaseClient:
    data = overrides or {}
    endpoint = str(data.get("endpoint") or _env("S3_ENDPOINT"))
    region = str(data.get("region") or _env("S3_REGION", "ru-1"))
    access_key_id = str(data.get("accessKeyId") or _env("S3_ACCESS_KEY_ID"))
    secret_access_key = str(data.get("secretAccessKey") or _env("S3_SECRET_ACCESS_KEY"))
    if not endpoint:
        raise RuntimeError("S3 endpoint не задан для транскрибации.")
    if not access_key_id or not secret_access_key:
        raise RuntimeError("S3 credentials не заданы для транскрибации.")

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        config=Config(signature_version="s3v4"),
    )


def _parse_source(body: dict[str, Any], s3_overrides: dict[str, Any] | None) -> SourcePayload:
    source = body.get("source")
    if isinstance(source, dict):
        key = str(source.get("key") or "").strip()
        if not key:
            raise RuntimeError("source.key обязателен.")
        bucket = str(source.get("bucket") or (s3_overrides or {}).get("bucket") or _env("S3_BUCKET"))
        if not bucket:
            raise RuntimeError("S3 bucket не задан.")
        return SourcePayload(bucket=bucket, key=key)

    if isinstance(source, str):
        source = source.strip()
        if source.startswith(("http://", "https://")):
            return SourcePayload(bucket="", key="", source_url=source)
        if source:
            return SourcePayload(bucket="", key="", source_path=source)

    source_url = str(body.get("sourceUrl") or "").strip()
    if source_url:
        return SourcePayload(bucket="", key="", source_url=source_url)

    source_path = str(body.get("sourcePath") or "").strip()
    if source_path:
        return SourcePayload(bucket="", key="", source_path=source_path)

    raise RuntimeError("Не передан источник для транскрибации.")


def _download_to_file(
    source: SourcePayload, s3_overrides: dict[str, Any] | None
) -> tuple[str, bool]:
    if source.source_path:
        path = Path(source.source_path)
        if not path.exists():
            raise RuntimeError(f"Локальный файл не найден: {path}")
        return str(path), False

    fd, temp_path = tempfile.mkstemp(prefix="ecolms-src-", suffix=".bin")
    os.close(fd)

    if source.source_url:
        with urlopen(source.source_url, timeout=120) as response, open(temp_path, "wb") as output:
            shutil.copyfileobj(response, output)
        return temp_path, True

    client = _build_s3_client(s3_overrides)
    with open(temp_path, "wb") as output:
        client.download_fileobj(source.bucket, source.key, output)
    return temp_path, True


def _extract_audio_wav(source_path: str) -> str:
    fd, audio_path = tempfile.mkstemp(prefix="ecolms-audio-", suffix=".wav")
    os.close(fd)
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
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        audio_path,
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        details = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"FFmpeg preprocessing failed: {details or 'unknown error'}")
    return audio_path


def _whisper_model() -> tuple[WhisperModel, str]:
    global _MODEL
    model_size = _env("WHISPER_MODEL_SIZE", "small")
    compute_type = _env("WHISPER_COMPUTE_TYPE", "int8")
    if _MODEL is None:
        _MODEL = WhisperModel(model_size, device="cpu", compute_type=compute_type)
    return _MODEL, f"faster-whisper/{model_size}"


def _transcribe(audio_path: str, language: str | None = None) -> dict[str, Any]:
    model, model_name = _whisper_model()
    segments_iter, info = model.transcribe(
        audio_path,
        language=language or None,
        vad_filter=True,
    )
    segments = []
    text_parts: list[str] = []
    for segment in segments_iter:
        clean = segment.text.strip()
        if clean:
            text_parts.append(clean)
        segments.append(
            {
                "start": float(segment.start),
                "end": float(segment.end),
                "text": clean,
            }
        )

    duration = float(getattr(info, "duration", 0.0) or 0.0)
    return {
        "text": " ".join(text_parts).strip(),
        "segments": segments,
        "duration": duration,
        "model": model_name,
        "language": getattr(info, "language", language or "unknown"),
    }


class Handler(BaseHTTPRequestHandler):
    def _write_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._write_json(
                200,
                {
                    "success": True,
                    "data": {
                        "status": "ok",
                        "service": "transcription-service",
                    },
                    "error": None,
                },
            )
            return

        self._write_json(404, {"success": False, "data": None, "error": {"code": "NOT_FOUND", "message": "Route not found"}})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/transcribe":
            self._write_json(404, {"success": False, "data": None, "error": {"code": "NOT_FOUND", "message": "Route not found"}})
            return

        source_path = None
        cleanup_source_path = False
        audio_path = None
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = self.rfile.read(length) if length else b"{}"
            body = json.loads(payload.decode("utf-8") or "{}")

            s3_overrides = body.get("s3") if isinstance(body.get("s3"), dict) else None
            source = _parse_source(body, s3_overrides)
            source_path, cleanup_source_path = _download_to_file(source, s3_overrides)
            audio_path = _extract_audio_wav(source_path)
            result = _transcribe(audio_path, language=body.get("language"))

            source_name = None
            if source.key:
                source_name = Path(source.key).name
            elif source.source_url:
                source_name = Path(urlparse(source.source_url).path).name
            elif source.source_path:
                source_name = Path(source.source_path).name

            self._write_json(
                200,
                {
                    "success": True,
                    "data": {
                        **result,
                        "source": {
                            "name": source_name,
                            "bucket": source.bucket or None,
                            "key": source.key or None,
                        },
                    },
                    "error": None,
                },
            )
        except Exception as exc:
            self._write_json(
                500,
                {
                    "success": False,
                    "data": None,
                    "error": {"code": "TRANSCRIPTION_ERROR", "message": str(exc)},
                },
            )
        finally:
            if audio_path:
                try:
                    Path(audio_path).unlink(missing_ok=True)
                except Exception:
                    pass
            if source_path and cleanup_source_path:
                try:
                    Path(source_path).unlink(missing_ok=True)
                except Exception:
                    pass


def main() -> None:
    port = int(os.getenv("TRANSCRIPTION_PORT", "3002"))
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(json.dumps({"service": "transcription-service", "port": port}, ensure_ascii=False))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
