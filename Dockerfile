FROM node:26-alpine AS base

WORKDIR /home/app

COPY package.json pnpm-lock.yaml ./

RUN npm install -g pnpm@9.15.9

FROM base AS development

ENV NODE_ENV=development

RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 5173

CMD ["pnpm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM base AS build

RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# Base public path: '/' normally, '/pr-<N>/' for per-PR previews.
ARG VITE_BASE=/
ENV VITE_BASE=${VITE_BASE}

RUN pnpm run build

FROM nginx:1.31.1-alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /home/app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
