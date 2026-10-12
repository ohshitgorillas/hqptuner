"""Type guards for values of unknown shape, such as a member of parsed JSON: isinstance-only, never with cast.

Each guard judges shape alone. Whether a value of the right shape is also in its field's domain is the caller's check.
"""

from typing import TypeGuard


def is_str(value: object) -> TypeGuard[str]:
    """Return whether ``value`` is a string."""
    return isinstance(value, str)


def is_opt_str(value: object) -> TypeGuard[str | None]:
    """Return whether ``value`` is a string or ``None``."""
    return value is None or isinstance(value, str)


def is_bool(value: object) -> TypeGuard[bool]:
    """Return whether ``value`` is a real ``bool``, never a truthy value of another type."""
    return isinstance(value, bool)


def is_int(value: object) -> TypeGuard[int]:
    """Return whether ``value`` is a real ``int``, excluding ``bool``: ``True`` is an ``int``, not a 1."""
    return isinstance(value, int) and not isinstance(value, bool)


def is_str_list(value: object) -> TypeGuard[list[str]]:
    """Return whether ``value`` is a list of strings."""
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def is_str_map(value: object) -> TypeGuard[dict[str, str]]:
    """Return whether ``value`` is a dict of string keys to string values."""
    return isinstance(value, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in value.items())
