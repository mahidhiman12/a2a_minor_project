# One container for the whole app: the React website + every agent.
# Built and run by Render (see render.yaml); works with any Docker host.
#
#   docker build -t nagrik-sahayak .
#   docker run -p 8000:8000 -e SECRET_KEY=... -e SERVICE_TOKEN=... nagrik-sahayak
#   -> http://localhost:8000

# ---- 1. build the website (frontend/dist) ----
FROM node:20-alpine AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. the backend, which also serves the built website ----
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app/backend
COPY backend/requirements-deploy.txt ./
RUN pip install -r requirements-deploy.txt
COPY backend/ ./
# config.FRONTEND_DIST = <repo>/frontend/dist  ->  /app/frontend/dist
COPY --from=web /app/frontend/dist /app/frontend/dist

# run as a normal user; the SQLite databases live in /app/backend/data/db
RUN useradd --create-home app && mkdir -p data/db && chown -R app:app /app/backend/data
USER app

# Render tells the app which port to use in $PORT; locally it is 8000.
EXPOSE 8000
CMD ["sh", "-c", "CONCIERGE_PORT=${PORT:-8000} exec python serve_all.py"]
