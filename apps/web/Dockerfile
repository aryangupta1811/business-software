# The web app: Vite builds static files, Caddy serves them and passes /api to the api
# container, the same job Caddy does on the server (ADR 0011).
# Build from the repo root: docker build -f apps/web/Dockerfile .
# No secret is needed or allowed here: everything in the build ends up in the browser.

FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm at the version in package.json "packageManager".
RUN corepack enable
WORKDIR /repo

# Manifests first: the install layer is reused until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @business-software/web...

COPY tsconfig.base.json ./
COPY apps/web apps/web
RUN pnpm --filter @business-software/web build

# Caddy is one static Go binary, so Alpine's musl doesn't matter here (unlike Node and
# PostgreSQL, ADRs 0019 and 0020).
FROM caddy:2.11-alpine
# Not root: a user that owns only Caddy's own state folders.
RUN addgroup -S web && adduser -S -G web web && chown -R web:web /data /config
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
RUN caddy validate --config /etc/caddy/Caddyfile
USER web
EXPOSE 8080
