# -----------------------------------------------------------------------------
# Bodogui PWA - build Vite puis service par Nginx
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS build

WORKDIR /app
ENV NODE_ENV=development

# Valeurs figees dans le bundle Vite au moment du build (Coolify : variables
# d'environnement, ou 'build.args' de docker-compose.yml).
#   VITE_INSTALL_GATE : invite (defaut, portail non bloquant) | mandatory | off
#   VITE_API_URL      : chemin de l'API servi par Nginx (defaut /api/v1)
ARG VITE_INSTALL_GATE
ARG VITE_API_URL
ENV VITE_INSTALL_GATE=$VITE_INSTALL_GATE
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Configuration Nginx : SPA + cache long + proxy API et medias
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
