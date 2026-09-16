#!/usr/bin/env python3
"""Quote-aware shell reading for the free-Bash allowlist — shapes, no policy.

free_bash.py owns the question "is this command read-only?"; this owns the
mechanics that question needs before it can look at a single command name:
where the operators are, which text is quoted data rather than syntax, and
where the output of a stage goes.

Nothing here knows a command name. Every function answers a question about the
shape of the string, so a verdict change belongs in free_bash.py and a parsing
fix belongs here.

The one rule the two halves share: a `>` or `|` inside a quoted argument
(e.g. `grep -o '<m [^>]*'`) is data, not an operator. mask() is what makes that
true — it replaces quoted interiors with 'x' of the same length, so a position
found in the masked string indexes the original.
"""

import re

# substrings that can never appear benignly OUTSIDE quotes in a read-only command
BANNED_SUBSTR = ("`", "$(", "<(", ">(", "||", "--fix", "--write", "--in-place", "--output")

# Command substitutions that cannot run anything but themselves. Rewritten to a
# plain word before the `$(` ban is applied, so every other substitution meters.
SAFE_SUBST = re.compile(r"\$\((?:pwd|git rev-parse --show-toplevel)\)")

REDIR_OP = re.compile(r"(\d*)(&>>|&>|>>|>&|>)")  # optional fd + output op
BG_AMP = re.compile(r"(?<![>&])&(?![&>])")  # a lone background &


def is_scratch(p):
    """A path under a session scratchpad dir (/tmp/claude-*/…/scratchpad/…)."""
    return ".." not in p and bool(re.match(r"/tmp/claude[^/]*/.+/scratchpad(?:/|$)", p))


def redir_target_ok(t):
    return t == "/dev/null" or is_scratch(t)


def mask(s):
    """Replace the interior of every quoted span with 'x', preserving length and
    all unquoted characters. Lets operator/redirect detection ignore quoted
    data. Returns None on an unbalanced quote."""
    res, q = [], None
    for c in s:
        if q:
            res.append(c if c == q else "x")
            if c == q:
                q = None
        elif c in ("'", '"'):
            q = c
            res.append(c)
        else:
            res.append(c)
    return None if q is not None else "".join(res)


def split(masked, orig, pattern):
    """Split orig at the positions where pattern matches in masked (same length).
    Returns a list of (masked_part, orig_part)."""
    parts, last = [], 0
    for m in re.finditer(pattern, masked):
        parts.append((masked[last : m.start()], orig[last : m.start()]))
        last = m.end()
    parts.append((masked[last:], orig[last:]))
    return parts


def read_word(s, i):
    """Read one shell word from s starting at i (skipping leading blanks),
    respecting quotes. Returns (unquoted_value, end_index)."""
    n = len(s)
    while i < n and s[i] in " \t":
        i += 1
    val, q = [], None
    while i < n:
        c = s[i]
        if q:
            if c == q:
                q = None
            else:
                val.append(c)
        elif c in ("'", '"'):
            q = c
        elif c in " \t|;&<>":
            break
        else:
            val.append(c)
        i += 1
    return "".join(val), i


def analyze_redirects(mstage, ostage):
    """Validate every output redirect targets only /dev/null, an fd-dup, or the
    scratchpad, and reject a background `&`. Returns ostage with the redirect
    tokens removed (ready for shlex), or None if anything is unsafe."""
    if BG_AMP.search(mstage):
        return None
    spans = []
    for m in REDIR_OP.finditer(mstage):
        op = m.group(2)
        tgt, wend = read_word(ostage, m.end())
        if op == ">&" and (tgt == "-" or tgt.isdigit()):
            spans.append((m.start(), wend))  # fd dup, no file
            continue
        if not tgt or not redir_target_ok(tgt):
            return None
        spans.append((m.start(), wend))
    clean, last = [], 0
    for a, b in sorted(spans):
        clean.append(ostage[last:a])
        last = b
    clean.append(ostage[last:])
    return "".join(clean)
