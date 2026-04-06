from __future__ import annotations

import json
from dataclasses import asdict, dataclass
import os
import time


@dataclass(slots=True)
class WorkerConfig:
    api_base_url: str = "http://localhost:3001"
    transcription_service_url: str = "http://localhost:3002"
    s3_bucket: str = "ecolms"


def load_config() -> WorkerConfig:
    return WorkerConfig(
        api_base_url=os.getenv("API_BASE_URL", "http://localhost:3001"),
        transcription_service_url=os.getenv(
            "TRANSCRIPTION_SERVICE_URL", "http://localhost:3002"
        ),
        s3_bucket=os.getenv("S3_BUCKET", "ecolms"),
    )


def main() -> None:
    config = load_config()
    print(json.dumps({"service": "worker", "config": asdict(config)}, ensure_ascii=False, indent=2))
    try:
        while True:
            time.sleep(30)
            print(
                json.dumps(
                    {"service": "worker", "status": "heartbeat"},
                    ensure_ascii=False,
                )
            )
    except KeyboardInterrupt:
        print(json.dumps({"service": "worker", "status": "stopped"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
