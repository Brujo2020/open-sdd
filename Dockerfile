# open-sdd — container image.
#
# Multi-stage: the first stage installs the CLI's dev dependencies and compiles TypeScript; the
# final stage copies ONLY the compiled output, the templates and package.json. The CLI has no
# runtime dependencies (every import is relative or `node:`), so the final image ships no
# node_modules at all — dev dependencies cannot leak into it because nothing is installed there.
#
# Base tag is PINNED (minor + Alpine minor), not `latest` and not the floating `node:20-alpine`.
# To pin the exact bytes as well, append the manifest-list digest published by Docker Hub:
#   node:20.19-alpine3.23@sha256:658d0f63e501824d6c23e06d4bb95c71e7d704537c9d9272f488ac03a370d448
#
# Build:  docker build -t open-sdd .
# Run:    docker run --rm -v "$PWD:/work" open-sdd status
#
# The container runs as a non-root user (`sdd`). `status`/`gates`/`delta` only READ the mounted
# repository. For commands that WRITE into it (the installer, `--write`), either add
# `--user "$(id -u):$(id -g)"` or mount a writable copy: a container user cannot write into a
# directory owned by your host user.

# syntax=docker/dockerfile:1

# ── stage 1: build ────────────────────────────────────────────────────────────────────────────
FROM node:20.19-alpine3.23 AS build

WORKDIR /build

# Manifests first so the dependency layer is cached until they change.
COPY tools/open-sdd/package.json tools/open-sdd/package-lock.json ./
RUN npm ci

COPY tools/open-sdd/tsconfig.json ./
COPY tools/open-sdd/src ./src
COPY tools/open-sdd/scripts ./scripts
RUN npm run build

# ── stage 2: runtime ──────────────────────────────────────────────────────────────────────────
FROM node:20.19-alpine3.23 AS runtime

ENV NODE_ENV=production

WORKDIR /app

# Only the built artifact, the templates the installer reads, and package.json (dist reads its
# own version from it). No package manager, no node_modules, no source, no dev dependencies.
COPY --from=build /build/dist ./dist
COPY --from=build /build/package.json ./package.json
COPY tools/open-sdd/templates ./templates

# Non-root. The mount point exists and is owned by the runtime user so a writable volume can be
# attached without a chown dance.
RUN addgroup -S sdd \
 && adduser -S -G sdd sdd \
 && mkdir -p /work \
 && chown -R sdd:sdd /app /work

USER sdd

# The CLI is the entrypoint: `docker run ... open-sdd status` runs `status` against /work.
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["status"]
