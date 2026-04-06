from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer


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

        length = int(self.headers.get("content-length", "0"))
        payload = self.rfile.read(length) if length else b"{}"
        body = json.loads(payload.decode("utf-8") or "{}")
        source = body.get("source") or "audio.wav"

        self._write_json(
            200,
            {
                "success": True,
                "data": {
                    "text": f"Псевдотранскрипт для {source}",
                    "segments": [],
                    "duration": 0,
                    "model": "openai/whisper",
                },
                "error": None,
            },
        )


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
