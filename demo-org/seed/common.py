"""Shared helpers for the seed: logging, retrying HTTP, generated secrets,
and the connection details WonderID needs (written at the end of the run)."""
from __future__ import annotations

import json
import os
import secrets
import string
import time
from pathlib import Path

import requests

GEN = Path("/generated")
ENV = os.environ
DOMAIN = ENV["DEMO_DOMAIN"]


def log(msg: str) -> None:
    print(msg, flush=True)


def password(n: int = 24) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(n))


class Http(requests.Session):
    """A session with a base URL that retries while a service is still starting."""

    def __init__(self, base: str):
        super().__init__()
        self.base = base.rstrip("/")

    def request(self, method, url, *a, retries: int = 5, ok: tuple[int, ...] = (), **kw):  # type: ignore[override]
        full = url if url.startswith("http") else f"{self.base}{url}"
        kw.setdefault("timeout", 60)
        for attempt in range(retries):
            try:
                r = super().request(method, full, *a, **kw)
            except requests.ConnectionError:
                if attempt == retries - 1:
                    raise
                time.sleep(3 * (attempt + 1))
                continue
            if r.status_code in (502, 503, 504) and attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
                continue
            if ok and r.status_code not in ok:
                raise RuntimeError(f"{method} {url} -> {r.status_code}: {r.text[:300]}")
            return r
        raise RuntimeError(f"{method} {url} failed")


_STATE = GEN / "seed-state.json"


def state() -> dict:
    """Secrets the seed created and must reuse on a re-run (kept on this machine only)."""
    if _STATE.exists():
        return json.loads(_STATE.read_text())
    return {}


def save_state(data: dict) -> None:
    _STATE.write_text(json.dumps(data, indent=2))
    os.chmod(_STATE, 0o600)


def remember(key: str, factory) -> str:
    data = state()
    if key not in data:
        data[key] = factory()
        save_state(data)
    return data[key]


CONNECTIONS: list[dict] = []


def connection(system: str, connector: str, settings: dict, secret: dict, notes: str = "") -> None:
    """One WonderID connection: which built-in connector, its settings and its secret values."""
    CONNECTIONS.append({"system": system, "connector": connector, "settings": settings, "secret": secret, "notes": notes})


def write_connections() -> None:
    GEN.mkdir(exist_ok=True)
    path = GEN / "wonderid-connections.json"
    # A run of some steps keeps the other systems' connections from earlier runs.
    fresh = {c["connector"] for c in CONNECTIONS}
    kept = [c for c in json.loads(path.read_text())] if path.exists() else []
    CONNECTIONS[:0] = [c for c in kept if c["connector"] not in fresh]
    path.write_text(json.dumps(CONNECTIONS, indent=2))
    os.chmod(path, 0o600)
    lines = ["# Planet Express: WonderID connection details", "",
             "Each block is one connection in WonderID (Integrations → Connectors → Connect).",
             "This file holds live credentials: keep it on this machine, never commit or share it.", ""]
    for c in CONNECTIONS:
        lines += [f"## {c['system']} — connector `{c['connector']}`", ""]
        if c["notes"]:
            lines += [c["notes"], ""]
        lines += ["Settings:", "```json", json.dumps(c["settings"], indent=2), "```", "Secret:", "```json", json.dumps(c["secret"], indent=2), "```", ""]
    md = GEN / "wonderid-connections.md"
    md.write_text("\n".join(lines))
    os.chmod(md, 0o600)
