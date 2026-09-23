#!/usr/bin/env python3
"""PreToolUse hook: the HQPlayer manual is read through the hqpdoc MCP tools, not the shell.

The hqpdoc server (`scripts/hqpdoc_mcp.py`) serves the manual and readme as
cited sections, pages and readme blocks. A `pdftotext` of the PDF puts the whole
dump, uncited, into context. Wired session-wide, so it binds every agent and
subagent.

Blocked: a Bash command that names hqplayer6desktop-manual.pdf and has a stage
headed by a PDF tool (poppler, qpdf, mutool, gs), where that stage names the
manual or names no PDF at all (it reads the manual off a pipe or `xargs`).
Wrappers (`sudo`, `env`, `timeout`, `nice`, `xargs`, ...) and their option
values are looked through, stages are split with quoting respected, and
`bash -c` / `sh -lc` bodies are checked as commands of their own.

Everything else passes: `make manual` and `scripts/build_manual.py` run
pdftotext inside Python, where no Bash command names it, and `ls`, `git`,
`stat` or `file` on the PDF read no content.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import sys

MANUAL = "hqplayer6desktop-manual.pdf"

#: head commands that extract or render PDF content
PDF_TOOLS = frozenset(
    {"pdftotext", "pdfinfo", "pdftoppm", "pdftohtml", "pdfimages", "pdffonts", "pdftocairo", "qpdf", "mutool", "gs"}
)
#: commands that run the next word as the command; their own flags and numbers are skipped
WRAPPERS = frozenset({"sudo", "env", "timeout", "nice", "ionice", "command", "exec", "xargs", "time", "stdbuf"})
#: wrapper options whose value is the next word, so that word is not taken for the command
WRAPPER_VALUE_OPTS = {
    "sudo": frozenset({"-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-T", "-U"}),
    "env": frozenset({"-u", "-C", "--unset", "--chdir"}),
    "timeout": frozenset({"-s", "-k", "--signal", "--kill-after"}),
    "nice": frozenset({"-n", "--adjustment"}),
    "ionice": frozenset({"-c", "-n", "-p", "-P", "-u", "--class", "--classdata"}),
    "xargs": frozenset({"-I", "-L", "-P", "-a", "-d", "-E", "-n", "-s"}),
    "stdbuf": frozenset({"-i", "-o", "-e"}),
}
SHELLS = frozenset({"bash", "sh", "zsh"})
#: `-c`, `-lc`, `-ec`: a shell option cluster that makes the next word the command string
SHELL_C = re.compile(r"^-[A-Za-z]*c[A-Za-z]*$")
#: fallback stage separators, for a command shlex cannot tokenize (unbalanced quotes)
SEPARATORS = re.compile(r"\|\|?|&&?|;|\n|\$\(|[()`]")
#: characters shlex splits out as operator tokens
PUNCTUATION = "();<>|&\n"
#: operator characters that end a stage; `&` alone or doubled does too, `>&` does not
STAGE_BREAK = frozenset("|;()\n")

_WHY = (
    "Read the HQPlayer manual and readme through the hqpdoc MCP tools "
    "(hqp_find, hqp_section, hqp_page, hqp_readme, hqp_toc), not from the shell. "
    "They cite section and page and keep the dump out of context."
)


def _is_break(token: str) -> bool:
    if not token or any(ch not in PUNCTUATION for ch in token):
        return False
    return token in {"&", "&&"} or any(ch in STAGE_BREAK for ch in token)


def _stages(cmd: str) -> list[list[str]]:
    """Split a command line into the word lists of its stages, respecting quotes.

    Pipes, lists, background, subshells, process and command substitution
    separate stages; a redirection such as `2>&1` stays inside its stage.
    """
    lexer = shlex.shlex(cmd.replace("`", " ; "), posix=True, punctuation_chars=PUNCTUATION)
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    try:
        tokens = list(lexer)
    except ValueError:
        return [stage.split() for stage in SEPARATORS.split(cmd)]
    stages: list[list[str]] = [[]]
    for token in tokens:
        if _is_break(token):
            stages.append([])
        else:
            stages[-1].append(token)
    return stages


def _head(words: list[str]) -> int:
    """Index of the word that is the command, past assignments, wrappers and wrapper options."""
    i = 0
    wrapper = ""
    while i < len(words):
        word = words[i]
        if word in WRAPPER_VALUE_OPTS.get(wrapper, ()):
            i += 2
        elif re.match(r"^\w+=", word) or word.startswith("-") or re.match(r"^\d+[smhd]?$", word):
            i += 1
        elif os.path.basename(word) in WRAPPERS:
            wrapper = os.path.basename(word)
            i += 1
        else:
            return i
    return len(words)


def _stage_denied(words: list[str]) -> bool:
    at = _head(words)
    if at >= len(words):
        return False
    head = os.path.basename(words[at])
    rest = words[at + 1 :]
    if head in SHELLS:
        flag = next((i for i, w in enumerate(rest) if SHELL_C.match(w)), None)
        return flag is not None and flag + 1 < len(rest) and verdict(rest[flag + 1]) is not None
    if head not in PDF_TOOLS:
        return False
    return any(MANUAL in w for w in words) or not any(w.endswith(".pdf") for w in rest)


def verdict(cmd: str) -> str | None:
    """Why this command is refused, or None to let it through."""
    if MANUAL not in cmd:
        return None
    return _WHY if any(_stage_denied(s) for s in _stages(cmd)) else None


def main() -> None:
    try:
        data = json.loads(sys.stdin.read())
    except (ValueError, OSError):
        return
    if data.get("tool_name") != "Bash":
        return
    reason = verdict((data.get("tool_input") or {}).get("command", ""))
    if reason is None:
        return
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )


def self_test() -> int:
    """Pin the verdicts: PDF tools on the manual deny, builds, metadata and other PDFs pass."""
    m = MANUAL
    deny = [
        f"pdftotext {m} -",
        f"pdftotext {m} - | grep -n -i -A12 'junk' | head -80",
        f"cd /home/atom/dev/hqptuner && pdftotext {m} - 2>/dev/null | grep junk",
        f"pdftotext -f 53 -l 54 -layout {m} -",
        f"pdftotext {m} /tmp/claude-1000/x/scratchpad/manual.txt; grep -n junk /tmp/x",
        f"/usr/bin/pdftotext {m} -",
        f"cat {m} | pdftotext - -",
        f"ls {m}; pdftotext {m} -",
        f"grep foo notes.txt | pdftotext {m} -",
        f"echo make manual && pdfinfo {m}",
        f"echo {m} | xargs pdftotext",
        f"timeout 60 nice -n 10 pdftoppm -f 3 -l 3 -png {m} /tmp/p",
        f"bash -c 'pdftotext {m} -'",
        f"x=$(pdftotext {m} -); echo $x",
        f"pdffonts {m}",
        f"qpdf --decrypt {m} out.pdf",
        f"mutool draw -F txt {m}",
        f"gs -dQUIET -sDEVICE=txtwrite -o - {m}",
        f"bash -c 'pdftotext {m} - | grep junk'",
        f"bash -lc 'pdftotext {m} -'",
        f"sudo -u atom pdftotext {m} -",
        f"timeout -s KILL 60 pdftotext {m} -",
        f"echo {m} | xargs -I {{}} pdftotext {{}} -",
        f"env -u FOO pdftotext {m} -",
        f"diff <(pdftotext {m} -) notes.txt",
        f"x=`pdftotext {m} -`; echo $x",
        f"ls\npdftotext {m} -",
    ]
    allow = [
        "make manual",
        ".venv/bin/python scripts/build_manual.py",
        f"ls -la {m} hqplayerd-readme.txt",
        f"stat {m}",
        f"file {m}",
        f"git check-ignore -v {m}",
        f"git log -- {m}",
        "pdftotext other.pdf -",
        "pdftotext -layout paper.pdf /tmp/x.txt",
        f"grep -rn '{m}' docs CLAUDE.md",
        f"pdftotext other.pdf - | grep foo; ls {m}",
        "echo hello",
        f"bash -c 'ls -la {m}'",
        f"echo 'pdftotext {m} -'",
        f"pdftotext other.pdf - 2>&1 | grep foo; stat {m}",
    ]
    bad = [c for c in deny if verdict(c) is None] + [c for c in allow if verdict(c) is not None]
    for c in bad:
        print(f"wrong verdict: {c!r}")
    print("manual-by-tool self-test:", "FAIL" if bad else "ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main())
