FROM python:3.12-slim

# Non-root runtime user; /state holds the two persistent dirs (backups incl.
# the pending-filters park, and the preset store).
RUN useradd --create-home --uid 1000 hqptuner && mkdir -p /state && chown hqptuner /state

WORKDIR /app
COPY pyproject.toml README.md ./
COPY hqptuner ./hqptuner
COPY data ./data
RUN pip install --no-cache-dir .

# data/ lives at the repo root, not inside the installed package — point the
# app at the baked-in copy. Listen on all interfaces: the host-side scoping
# decision belongs to the port mapping / network mode, not the bind address.
ENV HQPTUNER_DATA_DIR=/app/data \
    HQPTUNER_BACKUP_DIR=/state/backups \
    HQPTUNER_PRESET_DIR=/state/presets \
    HQPTUNER_LISTEN_HOST=0.0.0.0

USER hqptuner
EXPOSE 8090

# python:slim ships no curl; urllib is enough for a liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"HQPTUNER_LISTEN_PORT\", \"8090\")}/api/health', timeout=4)"

CMD ["python", "-m", "hqptuner"]
