#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


def _now_label() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%SZ")


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    return []


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, indent=2)


@dataclass(slots=True)
class DokployConfig:
    base_url: str
    api_key: str
    project_name: str = "EcoLMS"
    timeout_seconds: float = 30.0
    insecure: bool = False


class DokployClient:
    def __init__(self, config: DokployConfig) -> None:
        self.config = config
        self._api_prefix = config.base_url.rstrip("/") + "/api/"

    def _request(
        self,
        endpoint: str,
        *,
        method: str = "GET",
        query: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> Any:
        url = self._api_prefix + endpoint
        if query:
            encoded = urlparse.urlencode(
                {key: value for key, value in query.items() if value is not None}
            )
            if encoded:
                url = f"{url}?{encoded}"

        payload = None
        headers = {
            "accept": "application/json",
            "x-api-key": self.config.api_key,
        }
        if body is not None:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["content-type"] = "application/json; charset=utf-8"

        req = urlrequest.Request(
            url,
            method=method.upper(),
            data=payload,
            headers=headers,
        )

        try:
            context = None
            if self.config.insecure:
                context = ssl._create_unverified_context()
            with urlrequest.urlopen(
                req, timeout=self.config.timeout_seconds, context=context
            ) as response:
                raw = response.read().decode("utf-8")
        except urlerror.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(
                f"{endpoint}: HTTP {exc.code}: {details or exc.reason}"
            ) from exc
        except urlerror.URLError as exc:
            raise RuntimeError(f"{endpoint}: network error: {exc.reason}") from exc

        if not raw.strip():
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"raw": raw}

    def project_all(self) -> list[dict[str, Any]]:
        data = self._request("project.all")
        return [item for item in _as_list(data) if isinstance(item, dict)]

    def project_by_name(self, name: str) -> dict[str, Any]:
        projects = self.project_all()
        for project in projects:
            if str(project.get("name", "")).strip().lower() == name.strip().lower():
                return project
        available = ", ".join(sorted(str(item.get("name", "")) for item in projects)) or "none"
        raise RuntimeError(f"Project '{name}' not found. Available: {available}")

    def deployment_all_by_type(self, entity_id: str, entity_type: str) -> list[dict[str, Any]]:
        data = self._request(
            "deployment.allByType",
            query={"id": entity_id, "type": entity_type},
        )
        return [item for item in _as_list(data) if isinstance(item, dict)]

    def deployment_all_by_server(self, server_id: str) -> list[dict[str, Any]]:
        data = self._request("deployment.allByServer", query={"serverId": server_id})
        return [item for item in _as_list(data) if isinstance(item, dict)]

    def compose_load_services(self, compose_id: str) -> list[dict[str, Any]]:
        data = self._request("compose.loadServices", query={"composeId": compose_id})
        return [item for item in _as_list(data) if isinstance(item, dict)]

    def raw_call(
        self,
        endpoint: str,
        *,
        method: str = "GET",
        query: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> Any:
        return self._request(endpoint, method=method, query=query, body=body)


def _pick_latest(deployments: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not deployments:
        return None

    def _key(item: dict[str, Any]) -> str:
        return str(
            item.get("createdAt")
            or item.get("updatedAt")
            or item.get("finishedAt")
            or item.get("startedAt")
            or ""
        )

    return sorted(deployments, key=_key, reverse=True)[0]


def _status_line(kind: str, name: str, item: dict[str, Any], latest: dict[str, Any] | None) -> str:
    app_status = str(item.get("applicationStatus") or item.get("status") or "unknown")
    dep_status = str(latest.get("status") or latest.get("applicationStatus") or "n/a") if latest else "n/a"
    dep_time = str(
        latest.get("createdAt") or latest.get("updatedAt") or latest.get("finishedAt") or "n/a"
    ) if latest else "n/a"
    return f"[{kind}] {name}: service={app_status}, deployment={dep_status}, at={dep_time}"


def command_status(client: DokployClient, args: argparse.Namespace) -> int:
    project = client.project_by_name(args.project)
    print(f"Dokploy project: {project.get('name')} ({project.get('projectId')})")
    print(f"Checked at: {_now_label()}")

    services_found = 0

    applications = _as_list(project.get("applications"))
    for app in applications:
        if not isinstance(app, dict):
            continue
        app_id = str(app.get("applicationId") or "")
        name = str(app.get("name") or app.get("appName") or app_id or "application")
        deployments = client.deployment_all_by_type(app_id, "application") if app_id else []
        latest = _pick_latest(deployments)
        print(_status_line("application", name, app, latest))
        services_found += 1

    compose_items = _as_list(project.get("compose"))
    for comp in compose_items:
        if not isinstance(comp, dict):
            continue
        compose_id = str(comp.get("composeId") or "")
        name = str(comp.get("name") or comp.get("appName") or compose_id or "compose")
        deployments = client.deployment_all_by_type(compose_id, "compose") if compose_id else []
        latest = _pick_latest(deployments)
        print(_status_line("compose", name, comp, latest))
        services_found += 1

        if args.with_services and compose_id:
            compose_services = client.compose_load_services(compose_id)
            for service in compose_services:
                service_name = str(service.get("name") or service.get("serviceName") or "service")
                service_status = str(service.get("status") or service.get("state") or "unknown")
                print(f"  - compose-service {service_name}: {service_status}")

    if services_found == 0:
        print("No services found in project payload.")
    return 0


def _extract_logs(deployment: dict[str, Any]) -> str:
    for key in ("logs", "log", "output", "deploymentLog", "deploymentLogs"):
        value = deployment.get(key)
        if isinstance(value, str) and value.strip():
            return value
        if isinstance(value, list) and value:
            return "\n".join(str(item) for item in value)
    return ""


def _resolve_item(
    project: dict[str, Any], entity_type: str, item_id: str | None, item_name: str | None
) -> tuple[str, str]:
    field = "applications" if entity_type == "application" else "compose"
    id_key = "applicationId" if entity_type == "application" else "composeId"
    items = [item for item in _as_list(project.get(field)) if isinstance(item, dict)]

    if item_id:
        for item in items:
            if str(item.get(id_key) or "") == item_id:
                name = str(item.get("name") or item.get("appName") or item_id)
                return item_id, name
        raise RuntimeError(f"{entity_type} with id '{item_id}' not found in project '{project.get('name')}'.")

    if item_name:
        for item in items:
            names = [str(item.get("name") or ""), str(item.get("appName") or "")]
            if any(name.strip().lower() == item_name.strip().lower() for name in names):
                resolved_id = str(item.get(id_key) or "")
                if not resolved_id:
                    break
                resolved_name = str(item.get("name") or item.get("appName") or resolved_id)
                return resolved_id, resolved_name
        raise RuntimeError(
            f"{entity_type} with name '{item_name}' not found in project '{project.get('name')}'."
        )

    if len(items) == 1:
        item = items[0]
        resolved_id = str(item.get(id_key) or "")
        resolved_name = str(item.get("name") or item.get("appName") or resolved_id)
        if resolved_id:
            return resolved_id, resolved_name

    raise RuntimeError(
        f"Specify --id or --name for {entity_type}. Available count in project: {len(items)}"
    )


def command_logs(client: DokployClient, args: argparse.Namespace) -> int:
    project = client.project_by_name(args.project)
    item_id, item_name = _resolve_item(project, args.type, args.id, args.name)
    deployments = client.deployment_all_by_type(item_id, args.type)
    latest = _pick_latest(deployments)
    if latest is None:
        print(f"No deployments found for {args.type} '{item_name}' ({item_id}).")
        return 0

    print(
        f"Project={project.get('name')} {args.type}={item_name} "
        f"deployment={latest.get('deploymentId', 'n/a')}"
    )
    logs = _extract_logs(latest)
    if not logs:
        print("Logs field is empty in deployment payload. Full deployment JSON:")
        print(json.dumps(latest, ensure_ascii=False, indent=2))
        return 0

    lines = logs.splitlines()
    tail = args.tail if args.tail > 0 else len(lines)
    for line in lines[-tail:]:
        print(line)
    return 0


def command_deployments(client: DokployClient, args: argparse.Namespace) -> int:
    project = client.project_by_name(args.project)
    item_id, item_name = _resolve_item(project, args.type, args.id, args.name)
    deployments = client.deployment_all_by_type(item_id, args.type)
    if not deployments:
        print(f"No deployments found for {args.type} '{item_name}' ({item_id}).")
        return 0

    if args.json:
        print(json.dumps(deployments, ensure_ascii=False, indent=2))
        return 0

    print(f"Deployments for {args.type} '{item_name}' ({item_id}):")
    sorted_items = sorted(
        deployments,
        key=lambda item: str(item.get("createdAt") or item.get("updatedAt") or ""),
        reverse=True,
    )
    for dep in sorted_items[: args.limit]:
        dep_id = dep.get("deploymentId", "n/a")
        status = dep.get("status") or dep.get("applicationStatus") or "unknown"
        created_at = dep.get("createdAt") or dep.get("updatedAt") or "n/a"
        print(f"- {dep_id}: status={status}, at={created_at}")
    return 0


def command_call(client: DokployClient, args: argparse.Namespace) -> int:
    query = {}
    for pair in args.query:
        if "=" not in pair:
            raise RuntimeError(f"Invalid --query format: '{pair}', expected key=value.")
        key, value = pair.split("=", 1)
        query[key] = value

    body = None
    if args.body:
        body = json.loads(args.body)

    payload = client.raw_call(
        args.endpoint,
        method=args.method,
        query=query or None,
        body=body,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Dokploy debug agent for EcoLMS test environment."
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("DOKPLOY_URL", "").strip(),
        help="Dokploy base URL, e.g. https://dokploy.example.com",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("DOKPLOY_API_KEY", "").strip(),
        help="Dokploy API key (x-api-key).",
    )
    parser.add_argument(
        "--project",
        default=os.getenv("DOKPLOY_PROJECT_NAME", "EcoLMS"),
        help="Dokploy project name (default: EcoLMS).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.getenv("DOKPLOY_TIMEOUT_SECONDS", "30")),
        help="HTTP timeout in seconds.",
    )
    parser.add_argument(
        "--insecure",
        action="store_true",
        default=bool(os.getenv("DOKPLOY_INSECURE", "").strip()),
        help="Disable TLS certificate verification for self-hosted Dokploy.",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    status = sub.add_parser("status", help="Show project service statuses.")
    status.add_argument(
        "--with-services",
        action="store_true",
        help="Also fetch compose.loadServices for each compose stack.",
    )

    logs = sub.add_parser("logs", help="Show logs from latest deployment payload.")
    logs.add_argument("--type", choices=("compose", "application"), default="compose")
    logs.add_argument("--id", help="Entity ID (composeId/applicationId).")
    logs.add_argument("--name", help="Entity name in project payload.")
    logs.add_argument("--tail", type=int, default=200, help="How many log lines to print.")

    deps = sub.add_parser("deployments", help="Show deployment history for one entity.")
    deps.add_argument("--type", choices=("compose", "application"), default="compose")
    deps.add_argument("--id", help="Entity ID (composeId/applicationId).")
    deps.add_argument("--name", help="Entity name in project payload.")
    deps.add_argument("--limit", type=int, default=20, help="Max deployments to print.")
    deps.add_argument("--json", action="store_true", help="Print raw JSON payload.")

    call = sub.add_parser("call", help="Raw Dokploy API call for quick debugging.")
    call.add_argument("endpoint", help="Endpoint name, e.g. project.all")
    call.add_argument("--method", default="GET", help="HTTP method.")
    call.add_argument(
        "--query",
        action="append",
        default=[],
        help="Query item in key=value format. Can be repeated.",
    )
    call.add_argument("--body", help="JSON body string for POST calls.")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if not args.base_url:
        print("DOKPLOY_URL is required (or pass --base-url).", file=sys.stderr)
        return 2
    if not args.api_key:
        print("DOKPLOY_API_KEY is required (or pass --api-key).", file=sys.stderr)
        return 2

    config = DokployConfig(
        base_url=args.base_url,
        api_key=args.api_key,
        project_name=args.project,
        timeout_seconds=args.timeout,
        insecure=args.insecure,
    )
    client = DokployClient(config)

    try:
        if args.command == "status":
            return command_status(client, args)
        if args.command == "logs":
            return command_logs(client, args)
        if args.command == "deployments":
            return command_deployments(client, args)
        if args.command == "call":
            return command_call(client, args)
        parser.print_help()
        return 2
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
