# Build from the repository root:
#   docker build -f apps/api/Dockerfile .

FROM node:22-alpine AS base
ENV COREPACK_HOME=/usr/local/share/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.34.7 --activate
WORKDIR /repo

# Keep only the api and the workspace packages it uses.
FROM base AS pruned
COPY . .
RUN pnpm dlx turbo@2.11.10 prune @erp/api --docker

FROM base AS build
COPY --from=pruned /repo/out/json/ ./
RUN pnpm install --frozen-lockfile
COPY --from=pruned /repo/out/full/ ./
RUN pnpm turbo run build --filter=@erp/api

# Includes packages/db and the Prisma CLI for the pre-deploy
# `pnpm --filter @erp/db db:migrate:deploy`.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo ./
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
