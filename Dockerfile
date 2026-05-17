FROM node:20-alpine AS base

WORKDIR /home/app

COPY package.json pnpm-lock.yaml ./

RUN apk add --no-cache git

RUN npm install -g pnpm@9.15.9

FROM base AS development

ENV NODE_ENV=development

RUN git init -q && pnpm install --frozen-lockfile && rm -rf .git lefthook.yml

COPY . .

EXPOSE 5173

CMD ["pnpm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM base AS build

RUN git init -q && pnpm install --frozen-lockfile && rm -rf .git lefthook.yml

COPY . .

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN pnpm run build

FROM nginx:1.27-alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /home/app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
