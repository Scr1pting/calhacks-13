FROM python:3.12-slim

WORKDIR /srv
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 DATABASE_PATH=/data/paramobility.db \
    DRIVE_CACHE_PATH=/data/drive_cache.json DEMO_CACHE_PATH=/data/demo_cache.json

COPY pyproject.toml ./
COPY app ./app
# Editable install keeps the code in /srv, next to prompts/.
RUN pip install -e .
COPY prompts ./prompts

VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
