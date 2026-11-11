FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN useradd --create-home --uid 10001 darna
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY alembic.ini pyproject.toml seed.py ./
COPY alembic ./alembic
COPY app ./app
RUN mkdir -p /app/storage && chown -R darna:darna /app/storage
USER darna
EXPOSE 8000
# Migrations run as a separate release step (see infra/docker-compose.yml `migrate` service).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
