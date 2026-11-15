"""The gate that holds a release to its checksums and signatures.

``scripts/gates/check_release_signatures.py`` reads the release and image
workflows, the package config and ``pyproject.toml``, and names every way a
release could ship without the checksum file signed, the packages signed, the
image signed, or a git dependency held to one commit. Cases drive the seams on
literal file text, and ``main(argv)`` on a checkout laid down under
``tmp_path``.

Seams are ``checksum_failures(name, source)``,
``package_signature_failures(name, source)``,
``image_signature_failures(name, source)``, ``git_pin_failures(name, source)``
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
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_release_signatures.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_release_signatures_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECKSUM_FAILURES = GATE.checksum_failures
PACKAGE_SIGNATURE_FAILURES = GATE.package_signature_failures
IMAGE_SIGNATURE_FAILURES = GATE.image_signature_failures
GIT_PIN_FAILURES = GATE.git_pin_failures
MAIN = GATE.main

#: A commit SHA as GitHub prints it.
SHA = "0123456789abcdef0123456789abcdef01234567"


# --- the checksum file ------------------------------------------------------

WRITE_SUMS = "          (cd dist && sha256sum a.deb b.rpm > SHA256SUMS)\n"
SIGN_SUMS = "          gpg --batch --armor --detach-sign --output dist/SHA256SUMS.asc dist/SHA256SUMS\n"
VERIFY_SUMS = "      - run: gpg --batch --verify dist/SHA256SUMS.asc dist/SHA256SUMS\n"
ATTACH_BOTH = "      - run: gh release create v1 dist/a.deb dist/b.rpm dist/SHA256SUMS dist/SHA256SUMS.asc\n"
ATTACH_SUMS = "      - run: gh release create v1 dist/a.deb dist/b.rpm dist/SHA256SUMS\n"
ATTACH_NONE = "      - run: gh release create v1 dist/a.deb dist/b.rpm\n"


def release_workflow(sign_step: str, publish_step: str) -> str:
    """A release workflow whose ``checksums`` job runs ``sign_step`` and whose ``publish`` runs ``publish_step``."""
    return (
        "jobs:\n"
        "  checksums:\n"
        "    steps:\n"
        "      - run: |\n"
        f"{sign_step}"
        "          true\n"
        "  publish:\n"
        "    steps:\n"
        f"{publish_step}"
    )


@pytest.mark.parametrize(
    ("sign_step", "publish_step", "count"),
    [
        (WRITE_SUMS + SIGN_SUMS, VERIFY_SUMS + ATTACH_BOTH, 0),
        (WRITE_SUMS, VERIFY_SUMS + ATTACH_BOTH, 1),
        (WRITE_SUMS + SIGN_SUMS, VERIFY_SUMS + ATTACH_SUMS, 1),
        (WRITE_SUMS + SIGN_SUMS, ATTACH_BOTH, 1),
        (WRITE_SUMS, ATTACH_SUMS, 3),
        ("", ATTACH_NONE, 4),
    ],
    ids=[
        "written, signed, verified, attached",
        "unsigned",
        "signature unattached",
        "unverified",
        "only written",
        "no sums",
    ],
)
def test_a_release_fails_once_per_missing_checksum_step(sign_step: str, publish_step: str, count: int) -> None:
    assert len(CHECKSUM_FAILURES("release.yml", release_workflow(sign_step, publish_step))) == count


def test_a_signature_step_that_is_only_a_comment_signs_nothing() -> None:
    commented = WRITE_SUMS + SIGN_SUMS.replace("gpg", "# gpg", 1)
    assert len(CHECKSUM_FAILURES("release.yml", release_workflow(commented, VERIFY_SUMS + ATTACH_BOTH))) == 1


def test_a_checksum_failure_names_its_file() -> None:
    lines = CHECKSUM_FAILURES("release.yml", release_workflow(WRITE_SUMS, VERIFY_SUMS + ATTACH_BOTH))
    assert [line.startswith("release.yml:") for line in lines] == [True]


# --- the deb and rpm signatures ---------------------------------------------


def nfpm_config(signed: tuple[str, ...], key_file: str = "${HQPTUNER_GPG_KEY_FILE}") -> str:
    """An nfpm config whose packages in ``signed`` each carry a signature block naming ``key_file``."""
    blocks = "".join(f"{package}:\n  signature:\n    key_file: '{key_file}'\n" for package in signed)
    return f"name: hqptuner\n{blocks}"


@pytest.mark.parametrize(
    ("signed", "count"),
    [(("deb", "rpm"), 0), (("rpm",), 1), (("deb",), 1), ((), 2)],
    ids=["both", "rpm only", "deb only", "neither"],
)
def test_a_package_config_fails_once_per_unsigned_package(signed: tuple[str, ...], count: int) -> None:
    assert len(PACKAGE_SIGNATURE_FAILURES("nfpm.yaml", nfpm_config(signed))) == count


@pytest.mark.parametrize("missing", ["deb", "rpm"])
def test_an_unsigned_package_failure_names_the_package(missing: str) -> None:
    signed = tuple(package for package in ("deb", "rpm") if package != missing)
    assert [missing in line for line in PACKAGE_SIGNATURE_FAILURES("nfpm.yaml", nfpm_config(signed))] == [True]


def test_a_signature_block_naming_no_key_signs_nothing() -> None:
    assert len(PACKAGE_SIGNATURE_FAILURES("nfpm.yaml", nfpm_config(("deb", "rpm"), key_file=""))) == 2


# --- the image signature ----------------------------------------------------


def image_workflow(environment: str, command: str) -> str:
    """An image workflow whose ``sign-image`` job sits in ``environment`` and runs ``command``."""
    return (
        "jobs:\n"
        "  build-push:\n"
        "    steps:\n"
        "      - run: docker buildx build --push .\n"
        "  sign-image:\n"
        "    needs: build-push\n"
        f"    environment: {environment}\n"
        "    steps:\n"
        "      - env:\n"
        "          DIGEST: ${{ needs.build-push.outputs.digest }}\n"
        f"        run: {command}\n"
    )


SIGN_DIGEST = 'cosign sign --yes --key env://COSIGN_PRIVATE_KEY "docker.io/o/r@${DIGEST}"'


@pytest.mark.parametrize(
    ("environment", "command", "count"),
    [
        ("image-signing", SIGN_DIGEST, 0),
        ("image-signing", "echo no signature", 1),
        ("signing", SIGN_DIGEST, 1),
        ("image-signing", "cosign sign --yes --key env://COSIGN_PRIVATE_KEY docker.io/o/r:latest", 1),
        ("image-signing", f"cosign sign --yes --key env://COSIGN_PRIVATE_KEY docker.io/o/r@sha256:{'a' * 64}", 0),
    ],
    ids=["signed by digest variable", "never signed", "outside image-signing", "signed by tag", "signed by digest"],
)
def test_an_image_workflow_fails_when_no_job_signs_an_image_by_digest(
    environment: str, command: str, count: int
) -> None:
    assert len(IMAGE_SIGNATURE_FAILURES("docker.yml", image_workflow(environment, command))) == count


# --- git dependencies -------------------------------------------------------


def pyproject_with(table: str) -> str:
    """A ``pyproject.toml`` carrying the project table and then ``table``."""
    return f'[project]\nname = "x"\nversion = "1"\n{table}'


@pytest.mark.parametrize(
    ("table", "count"),
    [
        (f'dependencies = ["filepawl[mv] @ git+https://h/f.git@{SHA}"]\n', 0),
        (f"dependencies = [\"a @ git+https://h/a.git@{SHA} ; python_version >= '3.14'\"]\n", 0),
        ('dependencies = ["numpy>=2"]\n', 0),
        ('dependencies = ["a @ git+https://h/a.git@v1.0"]\n', 1),
        ('dependencies = ["a @ git+https://h/a.git"]\n', 1),
        ('[project.optional-dependencies]\ndev = ["a @ git+https://h/a.git@main"]\n', 1),
        ('[dependency-groups]\nbackend = ["a @ git+https://h/a.git@main", {include-group = "dev"}]\n', 1),
        (f'[tool.uv.sources]\na = {{ git = "https://h/a.git", rev = "{SHA}" }}\n', 0),
        ('[tool.uv.sources]\na = { git = "https://h/a.git", branch = "main" }\n', 1),
        ('[tool.uv.sources]\na = { path = "../a" }\n', 0),
    ],
    ids=[
        "commit with extras",
        "commit with marker",
        "registry",
        "tag",
        "no ref",
        "optional dependency on a branch",
        "dependency group on a branch",
        "uv source at a commit",
        "uv source on a branch",
        "uv path source",
    ],
)
def test_a_git_dependency_fails_unless_it_names_a_full_commit(table: str, count: int) -> None:
    assert len(GIT_PIN_FAILURES("pyproject.toml", pyproject_with(table))) == count


def test_an_unpinned_git_dependency_failure_names_the_dependency() -> None:
    lines = GIT_PIN_FAILURES("pyproject.toml", pyproject_with('dependencies = ["a @ git+https://h/a.git@v1.0"]\n'))
    assert ["git+https://h/a.git@v1.0" in line for line in lines] == [True]


# --- main -------------------------------------------------------------------

#: The files of a checkout that passes, by path under its root.
GOOD_CHECKOUT = {
    ".github/workflows/release.yml": release_workflow(WRITE_SUMS + SIGN_SUMS, VERIFY_SUMS + ATTACH_BOTH),
    ".github/workflows/docker.yml": image_workflow("image-signing", SIGN_DIGEST),
    "packaging/linux/nfpm.yaml": nfpm_config(("deb", "rpm")),
    "pyproject.toml": pyproject_with(f'dependencies = ["a @ git+https://h/a.git@{SHA}"]\n'),
}

#: One broken copy of each file, by the same path.
BROKEN_FILE = {
    ".github/workflows/release.yml": release_workflow(WRITE_SUMS, ATTACH_SUMS),
    ".github/workflows/docker.yml": image_workflow("image-signing", "echo no signature"),
    "packaging/linux/nfpm.yaml": nfpm_config(()),
    "pyproject.toml": pyproject_with('dependencies = ["a @ git+https://h/a.git@main"]\n'),
}


def lay_down(root: Path, files: dict[str, str]) -> list[str]:
    """Write ``files`` under ``root`` and return the argv naming that checkout."""
    for relative, text in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return [str(root)]


@pytest.mark.parametrize(
    ("broken", "code"), [("", 0), *((path, 1) for path in sorted(BROKEN_FILE))], ids=["none", *sorted(BROKEN_FILE)]
)
def test_a_checkout_exits_nonzero_only_when_a_file_is_broken(tmp_path: Path, broken: str, code: int) -> None:
    files = {**GOOD_CHECKOUT, broken: BROKEN_FILE[broken]} if broken else GOOD_CHECKOUT
    assert MAIN(lay_down(tmp_path, files)) == code


@pytest.mark.parametrize("missing", sorted(GOOD_CHECKOUT))
def test_a_checkout_missing_one_file_exits_nonzero(tmp_path: Path, missing: str) -> None:
    files = {path: text for path, text in GOOD_CHECKOUT.items() if path != missing}
    assert MAIN(lay_down(tmp_path, files)) == 1


def test_a_checkout_failure_is_printed_on_stdout(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    MAIN(lay_down(tmp_path, {**GOOD_CHECKOUT, "pyproject.toml": BROKEN_FILE["pyproject.toml"]}))
    assert "git+https://h/a.git@main" in capsys.readouterr().out


def own_argv(_root: Path) -> list[str]:
    """No argument: the gate reads the checkout it sits in."""
    return []


def broken_argv(root: Path) -> list[str]:
    """The argv naming a checkout under ``root`` whose release leaves its checksum file unsigned."""
    release = ".github/workflows/release.yml"
    return lay_down(root, {**GOOD_CHECKOUT, release: BROKEN_FILE[release]})


@pytest.mark.parametrize(("argv_for", "code"), [(own_argv, 0), (broken_argv, 1)], ids=["own", "broken"])
def test_the_repos_own_release_is_signed(tmp_path: Path, argv_for: Callable[[Path], list[str]], code: int) -> None:
    """The point of the gate: this repo's release signs its checksums, packages and images."""
    assert MAIN(argv_for(tmp_path)) == code
