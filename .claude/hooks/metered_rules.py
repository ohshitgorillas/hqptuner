#!/usr/bin/env python3
"""Why a call metered.

read-volume.py prints `Budget: N/8 (metered: <token>)` after every metered
call. That line answers "what did this cost", and the token answers "what
decided it".

Lives beside read-volume.py rather than inside it because this module is
reached from a PostToolUse hook and cannot stop anything.
"""


def why_metered(name, tool_input, budget):
    """A few words naming what made this call cost an action.

    For Bash the allowlist parser answers; for the other tools the class itself
    is the answer, and naming the tool is what makes the charge legible — an
    agent that reads "Agent(general-purpose)" knows to reach for Explore next
    time, where a bare count teaches nothing.
    """
    if name == "Bash":
        return budget.reason_metered(tool_input.get("command", ""))
    if name == "Agent":
        return f"Agent({tool_input.get('subagent_type')}) not a read-only type"
    if name in budget.EDIT_TOOLS:
        return f"{name} outside the working tree"
    return f"{name} not on the free list"
