# EisenFlow — front estático (Vite + React), publicado pelo Coolify a partir do GitHub.
#
# Duas etapas: a primeira compila; a segunda é só nginx com o build. As variáveis
# VITE_* entram em TEMPO DE BUILD (Vite as embute no bundle), por isso são ARG —
# no Coolify, marque-as como "Build Variable".
FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
