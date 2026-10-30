# syntax=docker/dockerfile:1
# linux/amd64 only; the cluster this targets is all x86_64.
#
#   docker buildx build --platform linux/amd64 --build-arg BUILD_ID=$(date +%Y%m%d)-slug \
#     -t registry.example.com/gotcha:TAG --push .
#
# Four stages. deps installs the lockfile once. build runs `next build` and
# precompiles the three tools the entrypoint needs. runtime carries the
# standalone server, the static files, the migrations and those tools, and
# nothing that only the build used. See docs/deploy.md.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
# corepack reads "packageManager" from package.json and fetches that exact pnpm.
# .npmrc is not copied in: its use-node-version would make pnpm download a
# second Node next to the image's own.
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# deps
# ---------------------------------------------------------------------------
# devDependencies stay in: next build needs typescript and tailwind, and the
# tools stage below needs esbuild, which tsx brings along.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Each workspace package's manifest, or --frozen-lockfile refuses the install.
COPY packages/cobblemon-assets/package.json packages/cobblemon-assets/
COPY packages/cpkmn/package.json packages/cpkmn/
COPY packages/pokedex/package.json packages/pokedex/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM base AS build
# Rides on the service worker URL so each deploy gets fresh caches
# (src/components/shell/RegisterSw.tsx). Pass the image tag.
ARG BUILD_ID=dev
ENV NEXT_PUBLIC_BUILD_ID=$BUILD_ID
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .

RUN pnpm build

# The extractor, the pokedex builder and the migrator are TypeScript run
# through tsx on a laptop. The image has no tsx and no node_modules outside
# the standalone trace, so esbuild bundles each into one self-contained .mjs.
# esbuild is reached through pnpm's hoisted virtual store rather than a
# dependency of its own; the path check makes a pnpm layout change a build
# failure instead of a runtime one.
#
# migrate.ts runs its own main() when it is argv[1], which the bundle is.
# The two CLIs guard on a `cli.ts` filename, so deploy/tools/ wraps them.
RUN test -x node_modules/.pnpm/node_modules/esbuild/bin/esbuild \
    && node_modules/.pnpm/node_modules/esbuild/bin/esbuild \
      extract=deploy/tools/extract.ts \
      pokedex=deploy/tools/pokedex.ts \
      migrate=src/lib/db/migrate.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --tsconfig=tsconfig.json --outdir=tools --out-extension:.js=.mjs \
      --log-level=warning \
      "--banner:js=import { createRequire as __gotchaCreateRequire } from 'node:module'; const require = __gotchaCreateRequire(import.meta.url);"

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    GOTCHA_DATA_DIR=/data \
    COBBLEMON_CACHE_DIR=/data/cobblemon-cache \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# The image's built-in "node" user is uid/gid 1000. The Deployment sets
# fsGroup: 1000 so a fresh PVC mounted at /data is writable by it.
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# migrate.ts resolves the migrations from process.cwd()/drizzle.
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/tools ./tools
COPY --chown=node:node --chmod=755 deploy/entrypoint.sh ./entrypoint.sh
USER node
EXPOSE 3000
VOLUME /data
# No HEALTHCHECK: the Kubernetes probes in deploy/k8s own that.
ENTRYPOINT ["/app/entrypoint.sh"]
