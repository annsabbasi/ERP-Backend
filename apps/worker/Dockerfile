# Build from the repository root:
#   docker build -f apps/worker/Dockerfile .

FROM node:22-alpine AS base
ENV COREPACK_HOME=/usr/local/share/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.34.7 --activate
WORKDIR /repo

# Keep only the worker and the workspace packages it uses.
FROM base AS pruned
COPY . .
RUN pnpm dlx turbo@2.11.10 prune @erp/worker --docker

FROM base AS build
COPY --from=pruned /repo/out/json/ ./
RUN pnpm install --frozen-lockfile
COPY --from=pruned /repo/out/full/ ./
RUN pnpm turbo run build --filter=@erp/worker

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo ./
USER node
CMD ["node", "apps/worker/dist/main.js"]
