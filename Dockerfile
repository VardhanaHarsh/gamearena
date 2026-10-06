# syntax=docker/dockerfile:1
# Single-service production image: builds the React SPA and the API; the API serves both
# (same origin → no CORS, the httpOnly refresh cookie and WebSockets just work).

FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    STATIC_DIR=/app/public \
    MIGRATIONS_DIR=/app/database/migrations \
    SEED_FILE=/app/database/seed/demo-data.json
WORKDIR /app/backend
COPY --from=backend /app/backend/node_modules ./node_modules
COPY --from=backend /app/backend/dist ./dist
COPY backend/package.json ./
COPY database /app/database
COPY --from=frontend /app/frontend/dist /app/public
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
