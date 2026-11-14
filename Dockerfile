# The runtime dependencies come from uv.lock, hashes checked, into a venv that
# the final stage copies; uv stays behind in this stage. uv is the image at the
# release the lock was made with, named by its digest.
FROM python:3.14-slim@sha256:9aaa474097d094040649f2162a627c0049b408f52138d980916788d80f04802f AS build

COPY --from=ghcr.io/astral-sh/uv:0.13.5@sha256:32a7bb39b496babbd997b0a39a4d66c126bdaf5661b302bf6f06abda8deca6ff /uv /usr/local/bin/uv

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
# Nothing builds in this sync, so a package with no wheel for this platform
# fails it. setuptools is in because the project builds with it below, isolation
# off, which keeps the backend the locked one and not one fetched unhashed.
RUN uv sync --locked --no-build --no-install-project --group backend

COPY hqptuner ./hqptuner
RUN uv sync --locked --no-editable --no-build-isolation-package hqptuner --group backend \
    && uv pip uninstall --python /opt/venv/bin/python setuptools

FROM python:3.14-slim@sha256:9aaa474097d094040649f2162a627c0049b408f52138d980916788d80f04802f

COPY --from=build /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Non-root runtime user; /state holds the two persistent dirs (backups incl.
# the pending-filters park, and the preset store).
RUN useradd --create-home --uid 1000 hqptuner && mkdir -p /state && chown hqptuner /state

WORKDIR /app

# The SPA and the metadata JSON ship inside the wheel (pyproject package-data),
# so the install is self-contained and needs no DATA_DIR override. Listen on all
# interfaces: the host-side scoping decision belongs to the port mapping /
# network mode, not the bind address.
ENV HQPTUNER_BACKUP_DIR=/state/backups \
    HQPTUNER_PRESET_DIR=/state/presets \
    HQPTUNER_LIVE_PRESET_FILE=/state/live-presets.json \
    HQPTUNER_FAVORITES_FILE=/state/favorites.json \
    HQPTUNER_DESCRIPTION_FILE=/state/descriptions.json \
    HQPTUNER_NARROWING_FILE=/state/narrowing.json \
    HQPTUNER_MATRIX_MODE_FILE=/state/matrixmodes.json \
    HQPTUNER_AUTOPILOT_FILE=/state/autopilot.json \
    HQPTUNER_CONNECTION_FILE=/state/connection.json \
    HQPTUNER_LISTEN_HOST=0.0.0.0 \
    HQPTUNER_IN_IMAGE=1

USER hqptuner
EXPOSE 8090

# python:slim ships no curl; urllib is enough for a liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"HQPTUNER_LISTEN_PORT\", \"8090\")}/api/health', timeout=4)"

CMD ["python", "-m", "hqptuner"]
