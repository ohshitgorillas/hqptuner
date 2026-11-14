#!/usr/bin/env bash
#
# Install uv at one pinned version, checked against the SHA-256 its release
# publishes for the archive, before anything in the archive runs.
#
#   scripts/ci/install-uv.sh <install-dir> [arch]
#
# `arch` names the CPU where `uname -m` cannot be trusted: an x64 shell on an
# Arm64 Windows runner reports x86_64. A missing checksum, a mismatch or a
# platform with no archive fails the step.

set -euo pipefail

UV_VERSION=0.13.5

dir=${1:?usage: install-uv.sh <install-dir> [arch]}
arch=${2:-$(uname -m)}

case "$arch" in
x86_64 | amd64 | x64) cpu=x86_64 ;;
aarch64 | arm64) cpu=aarch64 ;;
*)
	echo "install-uv: no uv archive for CPU '$arch'" >&2
	exit 1
	;;
esac

case "$(uname -s)" in
Linux)
	target="$cpu-unknown-linux-gnu"
	ext=tar.gz
	;;
Darwin)
	target="$cpu-apple-darwin"
	ext=tar.gz
	;;
MINGW* | MSYS* | CYGWIN*)
	target="$cpu-pc-windows-msvc"
	ext=zip
	;;
*)
	echo "install-uv: no uv archive for OS '$(uname -s)'" >&2
	exit 1
	;;
esac

archive="uv-$target.$ext"
base="https://github.com/astral-sh/uv/releases/download/$UV_VERSION"

mkdir -p "$dir"
dir=$(cd "$dir" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"

curl -LsSfO "$base/$archive"
curl -LsSfO "$base/$archive.sha256"

if command -v sha256sum >/dev/null 2>&1; then
	sha256sum -c "$archive.sha256"
else
	shasum -a 256 -c "$archive.sha256"
fi

if [ "$ext" = zip ]; then
	if command -v unzip >/dev/null 2>&1; then
		unzip -q -o "$archive" -d "$dir"
	else
		7z x -y "-o$dir" "$archive" >/dev/null
	fi
else
	tar -xzf "$archive" -C "$dir" --strip-components=1
fi

if [ -n "${GITHUB_PATH:-}" ]; then
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -w "$dir" >>"$GITHUB_PATH"
	else
		echo "$dir" >>"$GITHUB_PATH"
	fi
fi
