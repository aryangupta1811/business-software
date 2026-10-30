# One image, three commands: api (default), worker and migrate (ADRs 0004, 0020, 0021).
# Build from the repo root: docker build -f apps/api/Dockerfile .
# No secret ever goes in here (no ARG/ENV values, no .env): they arrive when the container
# starts, because anyone who can pull an image can read every layer (docs/devops/secrets.md).

FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm at the version in package.json "packageManager".
RUN corepack enable
WORKDIR /repo

# Manifests first: the install layer is reused until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @business-software/api...

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
# deploy copies the api with only its production dependencies, workspace packages included.
RUN pnpm --filter @business-software/api build \
 && pnpm --filter @business-software/api deploy --prod /out

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
