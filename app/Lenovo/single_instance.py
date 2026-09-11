#!/usr/bin/env python3
"""Per-device process guard for the channel sandbox."""
from __future__ import annotations

import os
from pathlib import Path

import psutil


class GuardHeldError(RuntimeError):
    """Raised when another live agent already holds a device."""


def cmdline_matches(tokens, device_id):
    """Return whether tokenized process arguments identify this exact agent."""
    return (
        any(
            os.path.basename(token.replace("\\", "/")).lower() == "device_agent.py"
            for token in tokens
        )
        and device_id in tokens
    )


def _read_owner(pidfile):
    try:
        lines = pidfile.read_text(encoding="ascii").splitlines()
        if len(lines) != 2:
            return None
        return int(lines[0]), float(lines[1])
    except (OSError, ValueError):
        return None


def check_guard(device_id, pidfile_path):
    """Return True only when the pidfile positively identifies a live owner."""
    owner = _read_owner(Path(pidfile_path))
    if owner is None:
        return False
    pid, expected_created = owner
    if pid == os.getpid():
        return False
    try:
        process = psutil.Process(pid)
        if abs(process.create_time() - expected_created) > 1e-3:
            return False
        return cmdline_matches(process.cmdline(), device_id)
    except (
        psutil.NoSuchProcess,
        psutil.AccessDenied,
        psutil.ZombieProcess,
        OSError,
    ):
        return False


def acquire_guard(device_id, pidfile_path):
    """Acquire a pidfile, replacing stale or unconfirmed ownership data."""
    pidfile = Path(pidfile_path)
    pidfile.parent.mkdir(parents=True, exist_ok=True)
    if check_guard(device_id, pidfile):
        raise GuardHeldError(
            f"another live agent already holds device {device_id} (pidfile {pidfile})"
        )
    try:
        pidfile.unlink(missing_ok=True)
        descriptor = os.open(pidfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    except FileExistsError as exc:
        raise GuardHeldError(
            f"another agent is acquiring device {device_id} (pidfile {pidfile})"
        ) from exc
    with os.fdopen(descriptor, "w", encoding="ascii") as handle:
        handle.write(f"{os.getpid()}\n{psutil.Process().create_time():.6f}\n")


def release_guard(pidfile_path):
    """Remove this process's pidfile without deleting a successor's guard."""
    pidfile = Path(pidfile_path)
    owner = _read_owner(pidfile)
    if owner is None or owner[0] != os.getpid():
        return
    try:
        pidfile.unlink(missing_ok=True)
    except OSError:
        pass
