# -----------------------------------------------------------------------------
# Bodogui API - image de production (Coolify)
# Base Debian (et non Alpine) : sharp dispose de binaires precompiles stables.
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS deps

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS=--max-old-space-size=384

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app/var/storage /data/backups \
 && chown -R node:node /app /data

WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
# Les migrations sont jouees au demarrage (idempotentes) avant de lancer l'API.
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
