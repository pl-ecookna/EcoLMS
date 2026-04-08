# Dokploy Debug Agent (EcoLMS)

Локальный CLI-агент для диагностики тестового контура в Dokploy:

- статус сервисов проекта;
- история деплоев;
- логи последнего деплоя;
- произвольные API-вызовы для отладки.

Скрипт: [scripts/dokploy_agent.py](/Users/romangaleev/CodeProject/Ecookna/EcoLMS/scripts/dokploy_agent.py)

## Подготовка

1. Указать переменные окружения:

```bash
export DOKPLOY_URL="https://<dokploy-host>"
export DOKPLOY_API_KEY="<api-key>"
export DOKPLOY_PROJECT_NAME="EcoLMS"
```

2. Запускать из корня репозитория:

```bash
python3 scripts/dokploy_agent.py --help
```

Если у Dokploy self-signed сертификат, добавьте `--insecure`
или `export DOKPLOY_INSECURE=1`.

## Команды

### 1) Статус проекта и сервисов

```bash
python3 scripts/dokploy_agent.py status
```

С деталями compose-сервисов:

```bash
python3 scripts/dokploy_agent.py status --with-services
```

### 2) История деплоев

По compose (по имени):

```bash
python3 scripts/dokploy_agent.py deployments --type compose --name EcoLMS
```

По application (по id):

```bash
python3 scripts/dokploy_agent.py deployments --type application --id <applicationId>
```

Raw JSON:

```bash
python3 scripts/dokploy_agent.py deployments --type compose --id <composeId> --json
```

### 3) Логи

Логи берутся из payload последнего деплоя выбранного объекта.

```bash
python3 scripts/dokploy_agent.py logs --type compose --id <composeId> --tail 300
```

или по имени:

```bash
python3 scripts/dokploy_agent.py logs --type compose --name EcoLMS --tail 300
```

### 4) Произвольный API-вызов

```bash
python3 scripts/dokploy_agent.py call project.all
python3 scripts/dokploy_agent.py call compose.one --query composeId=<composeId>
python3 scripts/dokploy_agent.py call compose.redeploy --method POST --body '{"composeId":"<composeId>"}'
```

## Примечания

- Агент использует API Dokploy вида `/api/<endpoint>` и заголовок `x-api-key`.
- По умолчанию проект: `EcoLMS`.
- Если нужный endpoint отсутствует в вашей версии Dokploy, используйте `call` для быстрой проверки актуального API.
