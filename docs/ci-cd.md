# CI/CD and Deployment Guide for UI

Документ описывает инфраструктуру frontend-сервиса `ui`: переменные окружения, Docker, локальный запуск, GitHub Actions и базовый deploy.

## Стек

- Node.js 20
- React 18
- TypeScript
- Vite
- ESLint
- Docker / Docker Compose
- Nginx для production-образа
- GitHub Actions

## Переменные окружения

Файл-пример находится в `ui/.env.example`. Для локального запуска создайте рабочий `.env`:

```bash
cd ui
cp .env.example .env
```

Основные переменные:

| Переменная | Назначение | Пример |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Base URL backend API для browser-кода | `/api/v1` |
| `VITE_APP_ENV` | Окружение сборки UI | `dev`, `stage`, `prod` |
| `VITE_APP_NAME` | Публичное имя приложения | `JS Notebook` |

Важно: Vite передает в browser только переменные с префиксом `VITE_`. Не храните secrets в `ui/.env`, потому что frontend-переменные попадают в итоговый JavaScript bundle.

## Docker

Frontend собирается из `ui/Dockerfile`.

Dockerfile содержит два основных target:

| Target | Назначение |
| --- | --- |
| `development` | Запуск Vite dev server на порту `5173` |
| `production` | Сборка статических файлов и запуск через Nginx на порту `80` |

Сборка development-образа:

```bash
docker build --target development -t js-notebook-ui:dev ./ui
```

Запуск development-образа:

```bash
docker run --rm \
  --env-file ui/.env \
  -p 3000:5173 \
  js-notebook-ui:dev
```

Сборка production-образа:

```bash
docker build --target production -t js-notebook-ui:prod ./ui
```

Запуск production-образа:

```bash
docker run --rm \
  -p 3000:80 \
  js-notebook-ui:prod
```

Проверка:

```bash
curl http://127.0.0.1:3000
```

## Docker Compose

Локальная инфраструктура поднимается из корня монорепозитория:

```bash
docker compose up --build
```

Сервисы:

| Сервис | URL | Назначение |
| --- | --- | --- |
| `frontend` | `http://127.0.0.1:3000` | React/Vite UI |
| `api` | `http://127.0.0.1:8000` | FastAPI backend |
| `postgres` | `127.0.0.1:5432` | PostgreSQL |
| `pgadmin` | `http://127.0.0.1:5050` | Админка БД |
| `proxy` | `http://127.0.0.1` | Nginx reverse proxy |

Полезные команды:

```bash
docker compose ps
docker compose logs -f frontend
docker compose down
docker compose down -v
```

## Локальная разработка без Docker

```bash
cd ui
npm ci
cp .env.example .env
npm run dev
```

Lint:

```bash
cd ui
npm run lint
```

Build:

```bash
cd ui
npm run build
```

В текущем шаблоне отдельный test script еще не добавлен. Для полноценного test pipeline можно подключить Vitest и React Testing Library, затем добавить `npm test` в `package.json` и отдельный job в GitHub Actions.

## GitHub Actions CI

Workflow для frontend находится в `.github/workflows/ui-ci.yml`.

Pipeline запускается при:

- push в `main`
- pull request в `main`
- изменениях в `ui/**` или самом workflow-файле

Этапы CI:

1. `lint`: установка зависимостей через `npm ci` и запуск `npm run lint`.
2. `build`: TypeScript/Vite production build через `npm run build`.
3. `docker-build`: сборка production Docker image из `ui/Dockerfile`.

Production-секреты frontend обычно не нужны, потому что все `VITE_` переменные публичные. Для environment-specific API URL используйте GitHub Actions Variables или build args:

| Variable | Назначение |
| --- | --- |
| `VITE_API_BASE_URL` | URL backend API для конкретного окружения |
| `VITE_APP_ENV` | Имя окружения |

Если будет добавлена публикация Docker-образа в registry, понадобятся secrets:

| Secret | Назначение |
| --- | --- |
| `REGISTRY_USERNAME` | Логин Docker registry |
| `REGISTRY_TOKEN` | Token/password Docker registry |

## Deployment

Базовый deploy-процесс:

1. Проверить, что PR прошел `lint`, `build` и `docker-build` в GitHub Actions.
2. Собрать production image:

```bash
docker build \
  --target production \
  --build-arg VITE_API_BASE_URL=/api/v1 \
  -t js-notebook-ui:<version> \
  ./ui
```

3. Запустить контейнер:

```bash
docker run -d \
  --name js-notebook-ui \
  --restart unless-stopped \
  -p 3000:80 \
  js-notebook-ui:<version>
```

4. Проверить доступность:

```bash
curl http://127.0.0.1:3000
```

5. Проверить логи:

```bash
docker logs -f js-notebook-ui
```

Обновление версии:

```bash
docker stop js-notebook-ui
docker rm js-notebook-ui
docker run -d \
  --name js-notebook-ui \
  --restart unless-stopped \
  -p 3000:80 \
  js-notebook-ui:<new-version>
```

Rollback:

```bash
docker stop js-notebook-ui
docker rm js-notebook-ui
docker run -d \
  --name js-notebook-ui \
  --restart unless-stopped \
  -p 3000:80 \
  js-notebook-ui:<previous-version>
```

## Definition of Done

- `ui/.env.example` содержит публичные frontend-переменные без secrets.
- `ui/Dockerfile` поддерживает development и production сборки.
- `docker compose up --build frontend` запускает UI локально.
- GitHub Actions выполняет lint, build и Docker build.
- `ui/docs/ci-cd.md` описывает локальный запуск, CI и deployment.
