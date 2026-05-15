# CI/CD and Deployment Guide for UI

Документ описывает инфраструктуру frontend-сервиса `ui`: переменные окружения, Docker, локальный запуск, GitHub Actions и базовый deploy.

## Стек

### Основной стек

- React 19
- TypeScript
- Vite 8+
- Node.js 20 LTS (Dockerfile использует `node:20-alpine`, CI — `node-version: "20"`)
- pnpm 9.15.9 (pinned через `packageManager` в `package.json`)

### Состояние и роутинг

- Reatom (`@reatom/core` + `@reatom/react`) — атомы, экшены, реактивные роуты, формы

### UI и стили

- Tailwind CSS v4
- shadcn/ui (base-ui renderer) — копируемые UI-примитивы в `src/shared/ui/`

### Тесты

- Vitest + jsdom
- @testing-library/react + @testing-library/jest-dom + @testing-library/user-event
- Скрипты: `pnpm test`, `pnpm test:watch`

### Качество кода

- ESLint (flat config, `eslint.config.js`)
- typescript-eslint
- eslint-plugin-react-hooks
- eslint-plugin-react-refresh

Отдельные prettier / simple-git-hooks / lint-staged в проекте пока не настроены.

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
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Lint, тесты и сборка:

```bash
pnpm lint
pnpm test
pnpm build
```

`pnpm-lock.yaml` — единственный lockfile в проекте. Использование `npm install` сгенерирует конфликтующий `package-lock.json` — не используйте `npm` здесь.

## GitHub Actions CI

Workflow для frontend находится в `.github/workflows/ui-ci.yml`.

Pipeline запускается при:

- push в `main`
- pull request в `main`
- изменениях в `ui/**` или самом workflow-файле

Этапы CI:

1. `lint`: `pnpm install --frozen-lockfile`, далее `pnpm run lint` и `pnpm run --if-present test`.
2. `build`: `pnpm install --frozen-lockfile`, далее `pnpm run build` (`tsc -b && vite build`).
3. `docker-build`: сборка production Docker image из `ui/Dockerfile` с тегом `js-notebook-ui:${{ github.sha }}` (зависит от `lint` и `build`).

Все job-ы используют `pnpm@9.15.9` (`pnpm/action-setup@v4`) и `node-version: "20"` с pnpm-кэшем (`cache-dependency-path: ui/pnpm-lock.yaml`). Чекаут — с `submodules: recursive`.

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
