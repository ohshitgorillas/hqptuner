"""The gate that holds the release pipeline's remote code to a pin.

``scripts/gates/check_supply_chain.py`` reads the checkout's workflows and
names every line that fetches code a remote party can change under the same
name. Cases drive the seams on literal workflow text, and ``main(argv)`` on a
checkout laid down under ``tmp_path``.

Seams are ``action_failures(name, source)``, ``pipe_failures(name, source)``,
``install_failures(name, source)``, ``dockerfile_failures(name, source)``,
``container_failures(name, source)``, ``permission_failures(name, source)``,
``secret_failures(name, source)``, ``signing_check_failures(name, source)``, ``login_script_failures(name, source)``
and ``main(argv)``.
"""

import importlib.util
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found by path: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_supply_chain.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_supply_chain_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
ACTION_FAILURES = GATE.action_failures
PIPE_FAILURES = GATE.pipe_failures
INSTALL_FAILURES = GATE.install_failures
DOCKERFILE_FAILURES = GATE.dockerfile_failures
CONTAINER_FAILURES = GATE.container_failures
PERMISSION_FAILURES = GATE.permission_failures
SECRET_FAILURES = GATE.secret_failures
SIGNING_CHECK_FAILURES = GATE.signing_check_failures
LOGIN_SCRIPT_FAILURES = GATE.login_script_failures
MAIN = GATE.main

#: A commit SHA as GitHub prints it.
SHA = "0123456789abcdef0123456789abcdef01234567"


def workflow_using(ref: str) -> str:
    """A workflow whose one step runs the action named by ``ref``."""
    return f"jobs:\n  build:\n    steps:\n      - uses: {ref}\n"


def checkout_with(root: Path, ref: str) -> list[str]:
    """Lay a checkout holding one workflow that uses ``ref``; the argv naming it."""
    workflows = root / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "ci.yml").write_text(workflow_using(ref), encoding="utf-8")
    return [str(root)]


# --- action pins ------------------------------------------------------------


def test_an_action_named_by_tag_names_its_file() -> None:
    assert "release.yml" in ACTION_FAILURES("release.yml", workflow_using("actions/checkout@v5"))[0]


def test_an_action_named_by_tag_names_its_ref() -> None:
    assert "actions/checkout@v5" in ACTION_FAILURES("release.yml", workflow_using("actions/checkout@v5"))[0]


@pytest.mark.parametrize(
    ("ref", "count"),
    [
        ("actions/checkout@v5", 1),
        ("docker/login-action@0123abc", 1),
        (f"actions/checkout@{SHA} # v5.0.0", 0),
        ("./.github/workflows/check.yml", 0),
    ],
    ids=["tag", "short sha", "full sha", "local call"],
)
def test_only_a_remote_action_not_named_by_a_full_sha_is_a_failure(ref: str, count: int) -> None:
    assert len(ACTION_FAILURES("release.yml", workflow_using(ref))) == count


# --- pipe to shell ----------------------------------------------------------


def workflow_running(command: str) -> str:
    """A workflow whose one step runs the shell line ``command``."""
    return f"jobs:\n  build:\n    steps:\n      - run: {command}\n"


@pytest.mark.parametrize(
    ("command", "count"),
    [
        ("curl -LsSf https://astral.sh/uv/install.sh | sh", 1),
        ("curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh", 1),
        ("wget -qO- https://example.org/install | sudo bash", 1),
        ("irm https://astral.sh/uv/install.ps1 | iex", 1),
        ("Invoke-RestMethod https://example.org/install.ps1 | Invoke-Expression", 1),
        ('curl -LsSfO "$base/checksums.txt"', 0),
        ('grep " $tarball\\$" checksums.txt | sha256sum -c -', 0),
        ("bash scripts/ci/install-uv.sh /usr/local/bin", 0),
    ],
    ids=["curl sh", "curl env sh", "wget sudo bash", "irm iex", "Invoke-RestMethod", "download", "checksum", "script"],
)
def test_only_a_fetched_script_piped_into_a_shell_is_a_failure(command: str, count: int) -> None:
    assert len(PIPE_FAILURES("release.yml", workflow_running(command))) == count


def test_a_piped_install_names_its_file_and_line() -> None:
    assert PIPE_FAILURES("release.yml", workflow_running("curl https://x | sh"))[0].startswith("release.yml:4:")


def test_a_checkout_with_a_piped_install_exits_nonzero(tmp_path: Path) -> None:
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "release.yml").write_text(workflow_running("curl https://x | sh"), encoding="utf-8")
    assert MAIN([str(tmp_path)]) == 1


# --- installs from the lock -------------------------------------------------


def job_running(job: str, command: str) -> str:
    """A workflow whose one job, named ``job``, runs the shell line ``command``."""
    return f"jobs:\n  {job}:\n    steps:\n      - run: {command}\n"


@pytest.mark.parametrize(
    ("command", "count"),
    [
        ('pip install -e ".[dev]"', 1),
        ('.venv/bin/pip install -e ".[dev]"', 1),
        ("python -m pip install requests", 1),
        ("uv pip install requests", 1),
        ("uv pip install . pyinstaller", 1),
        ("uv sync --python 3.14 --extra dev", 1),
        ("uv sync --frozen --extra dev", 1),
        ("uv tool install ruff", 1),
        ("uv pip install triviajudge requests", 1),
        ("uv pip install --python .venv/bin/python triviajudge==0.7.0 pytest", 1),
        ("uv pip install --python .venv/bin/python pytest", 1),
        ("uv sync --locked --python 3.14 --extra dev", 0),
        ("uv sync --locked --python 3.14 --extra dev --no-install-project --no-install-package filepawl", 0),
        ("uv pip install --python .venv/bin/python triviajudge", 0),
        ("uv pip install triviajudge", 0),
        ("npm ci", 0),
        ("make check IDLE_GATE=off", 0),
        ('bash scripts/ci/install-uv.sh "$RUNNER_TEMP/uv"', 0),
    ],
    ids=[
        "pip",
        "venv pip",
        "python -m pip",
        "uv pip",
        "uv pip dot",
        "sync unlocked",
        "sync frozen",
        "tool install",
        "extra name",
        "extra name after pin",
        "other name",
        "locked sync",
        "locked sync, no project",
        "triviajudge",
        "triviajudge, bare",
        "npm",
        "make",
        "install-uv",
    ],
)
def test_only_a_locked_sync_or_a_triviajudge_install_passes_in_check(command: str, count: int) -> None:
    assert len(INSTALL_FAILURES("check.yml", job_running("check", command))) == count


@pytest.mark.parametrize("job", ["check", "e2e"])
def test_an_unlocked_install_names_its_file_and_job(job: str) -> None:
    line = INSTALL_FAILURES("check.yml", job_running(job, "pip install requests"))[0]
    assert line.startswith(f"check.yml:4: job {job}:")


@pytest.mark.parametrize(
    ("step", "count"),
    [
        ("|\n          uv pip install --python .venv/bin/python \\\n            requests", 1),
        ("|\n          uv pip install --python .venv/bin/python \\\n            triviajudge", 0),
    ],
    ids=["other name", "triviajudge"],
)
def test_an_install_continued_over_lines_is_judged_whole(step: str, count: int) -> None:
    assert len(INSTALL_FAILURES("check.yml", job_running("check", step))) == count


@pytest.mark.parametrize(
    ("line", "count"),
    [("# never pip install here", 0), ("- run: pip install requests", 1)],
    ids=["comment", "step"],
)
def test_a_comment_naming_pip_install_is_not_an_install(line: str, count: int) -> None:
    source = f"jobs:\n  check:\n    steps:\n      {line}\n"
    assert len(INSTALL_FAILURES("check.yml", source)) == count


@pytest.mark.parametrize(("name", "count"), [("docker.yml", 0), ("check.yml", 1)], ids=["other workflow", "check"])
def test_only_a_workflow_under_the_lock_rule_is_judged(name: str, count: int) -> None:
    assert len(INSTALL_FAILURES(name, job_running("push", "pip install requests"))) == count


@pytest.mark.parametrize(
    ("job", "command", "count"),
    [
        ("build", "uv pip install . pyinstaller", 1),
        ("build-macos", "uv pip install . pyinstaller", 1),
        ("build-windows", "uv pip install . pyinstaller", 1),
        ("build", "uv pip install --python .venv/bin/python triviajudge", 1),
        ("build", "uv sync --locked --python 3.14 --group build --no-install-project", 0),
        ("build-windows", "uv sync --locked --python cpython-3.14-windows-x86_64-none --group build", 0),
        ("smoke", "pip install requests", 0),
    ],
    ids=["linux", "macos", "windows", "triviajudge", "locked linux", "locked windows", "job outside the rule"],
)
def test_the_release_build_jobs_install_only_from_the_lock(job: str, command: str, count: int) -> None:
    assert len(INSTALL_FAILURES("release.yml", job_running(job, command))) == count


def test_a_checkout_with_an_unlocked_install_in_check_exits_nonzero(tmp_path: Path) -> None:
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "check.yml").write_text(job_running("check", "pip install requests"), encoding="utf-8")
    assert MAIN([str(tmp_path)]) == 1


# --- image digests ----------------------------------------------------------

#: An image digest as a registry prints it.
DIGEST = "sha256:" + "0123456789abcdef" * 4


@pytest.mark.parametrize(
    ("dockerfile", "count"),
    [
        ("FROM python:3.14-slim\n", 1),
        ("FROM python:3.14-slim AS build\n", 1),
        ("FROM --platform=$BUILDPLATFORM python:3.14-slim\n", 1),
        ("FROM python:3.14-slim@sha256:abc123\n", 1),
        (f"FROM python:3.14-slim@{DIGEST}\n", 0),
        (f"FROM python:3.14-slim@{DIGEST} AS build\nFROM build\n", 0),
        ("FROM scratch\n", 0),
        ("COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /bin/uv\n", 1),
        (f"COPY --from=ghcr.io/astral-sh/uv:0.13.5@{DIGEST} /uv /bin/uv\n", 0),
        (f"FROM python:3.14-slim@{DIGEST} AS build\nCOPY --from=build /opt/venv /opt/venv\n", 0),
        ("# FROM python:3.14-slim\n", 0),
    ],
    ids=[
        "tag",
        "tag and stage",
        "platform flag",
        "short digest",
        "digest",
        "digest and stage reuse",
        "scratch",
        "copy from tag",
        "copy from digest",
        "copy from stage",
        "comment",
    ],
)
def test_only_an_image_without_a_full_digest_is_a_dockerfile_failure(dockerfile: str, count: int) -> None:
    assert len(DOCKERFILE_FAILURES("Dockerfile", dockerfile)) == count


def test_a_dockerfile_failure_names_its_file_and_line() -> None:
    assert DOCKERFILE_FAILURES("Dockerfile", f"FROM python:3.14-slim@{DIGEST} AS a\nFROM python:3.14\n")[0].startswith(
        "Dockerfile:2:"
    )


def job_with_container(job: str, image: str) -> str:
    """A workflow whose one job, named ``job``, runs in the container ``image``."""
    return f"jobs:\n  {job}:\n    runs-on: ubuntu-latest\n    container: {image}\n    steps: []\n"


@pytest.mark.parametrize(
    ("job", "image", "count"),
    [
        ("build", "almalinux:8", 1),
        ("build", f"almalinux:8@{DIGEST}", 0),
        ("build", "almalinux:8@sha256:abc123", 1),
        ("smoke", "almalinux:8", 0),
        ("smoke", "${{ matrix.distro.image }}", 0),
        ("lifecycle-rpm", "almalinux/8-init", 0),
    ],
    ids=["build tag", "build digest", "build short digest", "smoke tag", "smoke matrix", "lifecycle tag"],
)
def test_only_the_build_container_must_carry_a_digest(job: str, image: str, count: int) -> None:
    assert len(CONTAINER_FAILURES("release.yml", job_with_container(job, image))) == count


def test_a_build_container_failure_names_its_job_and_line() -> None:
    job = "build"
    line = CONTAINER_FAILURES("release.yml", job_with_container(job, "almalinux:8"))[0]
    assert line.startswith(f"release.yml:4: job {job}:")


def test_a_checkout_with_an_undigested_dockerfile_base_exits_nonzero(tmp_path: Path) -> None:
    (tmp_path / "Dockerfile").write_text("FROM python:3.14-slim\n", encoding="utf-8")
    (tmp_path / ".github" / "workflows").mkdir(parents=True)
    assert MAIN([str(tmp_path)]) == 1


# --- write permissions ------------------------------------------------------


def workflow_granting(top: str, job: str, grant: str) -> str:
    """A workflow with the top-level ``permissions:`` body ``top`` and one job, named ``job``, holding ``grant``."""
    return f"permissions:\n{top}\njobs:\n  {job}:\n    runs-on: ubuntu-latest\n{grant}\n    steps: []\n"


READ = "  contents: read"
WRITE_PACKAGES = "    permissions:\n      contents: read\n      packages: write"


@pytest.mark.parametrize(
    ("top", "job", "grant", "count"),
    [
        (f"{READ}\n  packages: write", "build-push", "", 1),
        (READ, "build-push", WRITE_PACKAGES, 0),
        (READ, "check", WRITE_PACKAGES, 1),
        (READ, "build-push", "    permissions:\n      contents: read", 0),
    ],
    ids=["workflow level", "the job that pushes", "another job", "a job that only reads"],
)
def test_packages_write_belongs_to_the_job_that_pushes_alone(top: str, job: str, grant: str, count: int) -> None:
    assert len(PERMISSION_FAILURES("docker.yml", workflow_granting(top, job, grant))) == count


def test_packages_write_in_another_workflow_is_a_failure() -> None:
    assert len(PERMISSION_FAILURES("release.yml", workflow_granting(READ, "build-push", WRITE_PACKAGES))) == 1


@pytest.mark.parametrize(
    ("source", "count"),
    [
        ("name: check\njobs:\n  check:\n    steps: []\n", 1),
        ("name: check\npermissions:\n  packages: read\njobs:\n  check:\n    steps: []\n", 1),
        ("name: check\npermissions:\n  contents: write\njobs:\n  check:\n    steps: []\n", 1),
        ("name: check\npermissions:\n  contents: read\njobs:\n  check:\n    steps: []\n", 0),
    ],
    ids=["none", "no contents", "contents write", "contents read"],
)
def test_check_declares_contents_read_at_the_top(source: str, count: int) -> None:
    assert len(PERMISSION_FAILURES("check.yml", source)) == count


def test_a_permission_failure_names_its_file_and_line() -> None:
    line = PERMISSION_FAILURES("docker.yml", workflow_granting(f"{READ}\n  packages: write", "build-push", ""))[0]
    assert line.startswith("docker.yml:3:")


def test_a_checkout_with_packages_write_at_the_top_exits_nonzero(tmp_path: Path) -> None:
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "docker.yml").write_text(workflow_granting(f"{READ}\n  packages: write", "x", ""), encoding="utf-8")
    assert MAIN([str(tmp_path)]) == 1


# --- signing secrets --------------------------------------------------------

CLEAN_BUILD = "      - run: scripts/package-macos.sh freeze\n"
BUILD_WITH_REPO_VALUE = "      - run: x\n        env:\n          T: ${{ secrets.GITHUB_TOKEN }}\n"
BUILD_WITH_APPLE = "      - run: x\n        env:\n          P: ${{ secrets.MACOS_CERT_PASSWORD }}\n"
SIGN_STEPS = "    steps:\n      - run: x\n        env:\n          N: ${{ secrets.NOTARY_KEY_ID }}\n"
SIGNING_ENV = "    environment: signing\n"


def release_with(build: str, sign: str) -> str:
    """A release workflow whose build-macos job holds the steps ``build`` and whose sign-macos job is ``sign``."""
    return (
        f"jobs:\n  build-macos:\n    runs-on: macos-15\n    steps:\n{build}  sign-macos:\n    runs-on: macos-15\n{sign}"
    )


@pytest.mark.parametrize(("build", "count"), [(BUILD_WITH_REPO_VALUE, 1), (CLEAN_BUILD, 0)], ids=["a secret", "none"])
def test_the_macos_build_job_reads_no_secret(build: str, count: int) -> None:
    assert len(SECRET_FAILURES("release.yml", release_with(build, SIGNING_ENV + SIGN_STEPS))) == count


def test_an_apple_secret_in_the_build_job_fails_twice_there() -> None:
    """Once as a secret in the build, once as an Apple secret outside the signing environment."""
    lines = SECRET_FAILURES("release.yml", release_with(BUILD_WITH_APPLE, SIGNING_ENV + SIGN_STEPS))
    assert len([line for line in lines if "job build-macos" in line]) == 2


@pytest.mark.parametrize(
    ("sign", "count"),
    [
        (SIGN_STEPS, 1),
        ("    environment: staging\n" + SIGN_STEPS, 1),
        (SIGNING_ENV + SIGN_STEPS, 0),
    ],
    ids=["no environment", "another environment", "signing"],
)
def test_a_job_that_imports_the_apple_secrets_sits_in_the_signing_environment(sign: str, count: int) -> None:
    assert len(SECRET_FAILURES("release.yml", release_with(CLEAN_BUILD, sign))) == count


@pytest.mark.parametrize(
    ("name", "count"), [("release.yml", 1), ("docker.yml", 0)], ids=["release", "another workflow"]
)
def test_a_release_with_no_job_that_signs_macos_fails(name: str, count: int) -> None:
    source = f"jobs:\n  build-macos:\n    runs-on: macos-15\n    steps:\n{CLEAN_BUILD}"
    assert len(SECRET_FAILURES(name, source)) == count


def test_a_signing_secret_failure_names_its_file_and_line() -> None:
    assert SECRET_FAILURES("release.yml", release_with(BUILD_WITH_REPO_VALUE, SIGNING_ENV + SIGN_STEPS))[0].startswith(
        "release.yml:7:"
    )


def test_a_checkout_whose_apple_secrets_sit_outside_the_signing_environment_exits_nonzero(tmp_path: Path) -> None:
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "release.yml").write_text(release_with(CLEAN_BUILD, SIGN_STEPS), encoding="utf-8")
    assert MAIN([str(tmp_path)]) == 1


def windows_job(secret: str, environment: str) -> str:
    """A package-windows job with the steps ``secret`` and the environment lines ``environment``."""
    return f"  package-windows:\n    runs-on: windows-latest\n{environment}    steps:\n{secret}"


SIMPLYSIGN_STEP = "      - run: x\n        env:\n          E: ${{ secrets.SIMPLYSIGN_EMAIL }}\n"
NO_STEP = "      - run: x\n"


@pytest.mark.parametrize(
    ("secret", "environment", "count"),
    [
        (SIMPLYSIGN_STEP, "", 1),
        (SIMPLYSIGN_STEP, SIGNING_ENV, 0),
        (NO_STEP, "", 1),
        (NO_STEP, SIGNING_ENV, 0),
    ],
    ids=["secret, no environment", "secret, signing", "named, no environment", "named, signing"],
)
def test_package_windows_sits_in_the_signing_environment_and_its_secrets_with_it(
    secret: str, environment: str, count: int
) -> None:
    source = "jobs:\n" + windows_job(secret, environment) + release_with(CLEAN_BUILD, SIGNING_ENV + SIGN_STEPS)[6:]
    assert len(SECRET_FAILURES("release.yml", source)) == count


@pytest.mark.parametrize("secret", ["GPG_PRIVATE_KEY", "MACOS_CERT_PASSWORD", "NOTARY_KEY_ID"])
def test_every_signing_secret_belongs_to_the_signing_environment(secret: str) -> None:
    step = f"      - run: x\n        env:\n          S: ${{{{ secrets.{secret} }}}}\n"
    assert len(SECRET_FAILURES("docker.yml", f"jobs:\n  publish:\n    steps:\n{step}")) == 1


CHECK_JOB = "  tag-check:\n    uses: ./.github/workflows/check.yml\n"
TAGGED_CHECK_JOB = (
    "  tag-check:\n    if: startsWith(github.ref, 'refs/tags/v')\n    uses: ./.github/workflows/check.yml\n"
)
OTHER_JOB = "  lint:\n    uses: ./.github/workflows/lint.yml\n"


def signing_job(needs: str) -> str:
    """A job in the signing environment that needs ``needs``."""
    return f"  package-windows:\n    needs: {needs}\n{SIGNING_ENV}    runs-on: windows-latest\n    steps: []\n"


SMOKE_JOB = "  smoke:\n    needs: build\n    steps: []\n"


@pytest.mark.parametrize(
    ("jobs", "count"),
    [
        (CHECK_JOB + signing_job("[build-windows, tag-check]"), 0),
        (CHECK_JOB + signing_job("tag-check"), 0),
        (CHECK_JOB + signing_job("build-windows"), 1),
        (TAGGED_CHECK_JOB + signing_job("tag-check"), 1),
        (OTHER_JOB + signing_job("lint"), 1),
        (signing_job("build-windows"), 1),
        (CHECK_JOB + SMOKE_JOB, 0),
    ],
    ids=["in a list", "alone", "not needed", "limited to tags", "another call", "no check job", "not a signing job"],
)
def test_a_signing_job_waits_on_a_check_that_runs_on_every_trigger(jobs: str, count: int) -> None:
    assert len(SIGNING_CHECK_FAILURES("release.yml", f"jobs:\n{jobs}")) == count


def test_a_signing_check_failure_names_its_file_job_and_line() -> None:
    job = "package-windows"
    line = SIGNING_CHECK_FAILURES("release.yml", f"jobs:\n{signing_job('build')}")[0]
    assert line.startswith(f"release.yml:4: job {job}:")


def test_a_checkout_whose_signing_job_waits_on_no_check_exits_nonzero(tmp_path: Path) -> None:
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "release.yml").write_text(f"jobs:\n{signing_job('build')}", encoding="utf-8")
    assert MAIN([str(tmp_path)]) == 1


# --- the SimplySign login script --------------------------------------------

PIN = "$InstallerSha256 = '" + "0123456789abcdef" * 4 + "'\n"
HASH_ONLY = "$actual = (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash\n"
CHECK = HASH_ONLY + "if ($actual -ne $InstallerSha256) { Fail 'x' }\n"
REMOVAL = "Remove-Item Env:SIMPLYSIGN_OTPAUTH_URI\n"


def login_script(*, pin: str = PIN, check: str = CHECK, removal: str = REMOVAL, late: str = "") -> str:
    """A login script that pins, checks and removes as the arguments say, then installs and launches the app."""
    return (
        f"$Version = '9'\n{pin}{removal}Say '[1/4] install'\nInvoke-WebRequest -Uri $u -OutFile $msi\n{check}"
        "$install = Start-Process -FilePath msiexec.exe -ArgumentList '/i' -Wait -PassThru\n"
        f"{late}Start-Process -FilePath $App\n"
    )


@pytest.mark.parametrize(
    ("script", "count"),
    [
        (login_script(), 0),
        (login_script(check=""), 1),
        (login_script(check="", late=CHECK), 1),
        (login_script(check=HASH_ONLY), 1),
        (login_script(pin="$InstallerSha256 = 'TODO'\n"), 1),
        (login_script(pin=""), 1),
    ],
    ids=["checked", "no check", "check after msiexec", "hash never compared", "pin is no hash", "no pin"],
)
def test_the_installer_is_hash_checked_against_a_pin_before_msiexec(script: str, count: int) -> None:
    assert len(LOGIN_SCRIPT_FAILURES("simplysign-login.ps1", script)) == count


@pytest.mark.parametrize(
    ("script", "count"),
    [
        (login_script(), 0),
        (login_script(removal=""), 1),
        (login_script(removal="", late=REMOVAL), 1),
        (login_script(removal="# " + REMOVAL), 1),
    ],
    ids=["removed first", "never removed", "removed after the first Start-Process", "only commented out"],
)
def test_the_seed_leaves_the_environment_before_the_first_start_process(script: str, count: int) -> None:
    assert len(LOGIN_SCRIPT_FAILURES("simplysign-login.ps1", script)) == count


def test_a_login_script_failure_names_its_file() -> None:
    assert LOGIN_SCRIPT_FAILURES("simplysign-login.ps1", login_script(removal=""))[0].startswith(
        "simplysign-login.ps1:"
    )


def test_a_checkout_whose_login_script_never_checks_the_installer_exits_nonzero(tmp_path: Path) -> None:
    script = tmp_path / "packaging" / "windows" / "simplysign-login.ps1"
    script.parent.mkdir(parents=True)
    script.write_text(login_script(check=""), encoding="utf-8")
    (tmp_path / ".github" / "workflows").mkdir(parents=True)
    assert MAIN([str(tmp_path)]) == 1


# --- main -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("ref", "code"), [("actions/checkout@v5", 1), (f"actions/checkout@{SHA} # v5.0.0", 0)], ids=["tag", "full sha"]
)
def test_a_checkout_exits_nonzero_only_when_an_action_is_named_by_tag(tmp_path: Path, ref: str, code: int) -> None:
    assert MAIN(checkout_with(tmp_path, ref)) == code


def test_a_checkout_failure_is_printed_on_stdout(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    MAIN(checkout_with(tmp_path, "actions/checkout@v5"))
    assert "actions/checkout@v5" in capsys.readouterr().out


def own_argv(_root: Path) -> list[str]:
    """No argument: the gate reads the checkout it sits in."""
    return []


def tagged_argv(root: Path) -> list[str]:
    """The argv naming a checkout under ``root`` whose one action is named by tag."""
    return checkout_with(root, "actions/checkout@v5")


@pytest.mark.parametrize(("argv_for", "code"), [(own_argv, 0), (tagged_argv, 1)], ids=["own", "tagged"])
def test_the_repos_own_workflows_pass(tmp_path: Path, argv_for: Callable[[Path], list[str]], code: int) -> None:
    """The point of the gate: this repo's workflows name every remote action by commit."""
    assert MAIN(argv_for(tmp_path)) == code
