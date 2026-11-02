#!/usr/bin/env python3
"""Snapshot the entire PythonAnywhere deployment locally.

Two paths:
  * `files` mode - walk the remote tree and download each file (paced for the
    free-account throttle).
  * `archive` mode - ask a remote bash console to tar the project once, download
    that single archive, and extract it locally (much faster, default when the
    tree is large).

Every run writes MASTER_MANIFEST.json (per-file size + sha256 + source) and
LEGACY_MANIFEST.json (the live HTTP surface: status, content-type, bytes) so a
restore or a diff is provable. Secrets are read from .pa/pa_credentials and are
never printed.

Usage:
  python tools/checkpoint_pa.py --discover
  python tools/checkpoint_pa.py --archive
  python tools/checkpoint_pa.py --archive --http
  python tools/checkpoint_pa.py --files
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tarfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CRED_FILE = os.path.join(REPO, ".pa", "pa_credentials")
API_ROOT = "https://www.pythonanywhere.com/api/v0/user"
LIVE_ORIGIN = "https://hdsat.pythonanywhere.com"


def load_credentials() -> tuple[str, str]:
    values: dict[str, str] = {}
    if os.path.exists(CRED_FILE):
        with open(CRED_FILE, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip()
    user = os.environ.get("PYTHONANYWHERE_USERNAME") or values.get("PYTHONANYWHERE_USERNAME", "")
    token = os.environ.get("API_TOKEN") or values.get("API_TOKEN", "")
    if not user or not token:
        sys.exit("missing PYTHONANYWHERE_USERNAME / API_TOKEN in .pa/pa_credentials")
    return user, token


class PA:
    def __init__(self, user: str, token: str):
        self.user = user
        self.token = token

    def _request(self, method: str, path: str, body: bytes | None = None,
                 headers: dict | None = None, timeout: int = 90, retries: int = 6):
        url = f"{API_ROOT}/{self.user}{path}"
        for attempt in range(retries):
            request = urllib.request.Request(url, data=body, method=method)
            request.add_header("Authorization", f"Token {self.token}")
            for key, value in (headers or {}).items():
                request.add_header(key, value)
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    return response.status, response.read(), dict(response.headers)
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "replace")
                if exc.code == 429:
                    match = re.search(r"available in (\d+) second", detail)
                    wait = int(match.group(1)) + 5 if match else 60
                    log(f"throttled on {path}; sleeping {wait}s")
                    time.sleep(wait)
                    continue
                return exc.code, detail.encode(), dict(exc.headers or {})
        return 0, b"", {}

    def tree(self, remote_path: str) -> list[str]:
        """The tree endpoint returns every path below the root, flat."""
        status, body, _ = self._request("GET", f"/files/tree/?path={remote_path}")
        if status != 200:
            raise RuntimeError(f"tree {remote_path} -> {status}: {body[:300]!r}")
        payload = json.loads(body)
        if isinstance(payload, dict):
            payload = payload.get("children", [])
        return payload

    def download(self, remote_path: str) -> bytes:
        status, body, _ = self._request(
            "GET", f"/files/path{remote_path}?download", timeout=180
        )
        if status != 200:
            raise RuntimeError(f"download {remote_path} -> {status}: {body[:200]!r}")
        return body

    def delete(self, remote_path: str) -> int:
        status, _, _ = self._request("DELETE", f"/files/path{remote_path}")
        return status

    def console(self, command: str, working_directory: str = "/home/" + "HDSAT",
                wait_seconds: int = 300) -> str:
        status, body, _ = self._request(
            "POST",
            "/consoles/",
            json.dumps({"executable": "bash", "working_directory": working_directory}).encode(),
            {"Content-Type": "application/json"},
        )
        if status not in (200, 201):
            raise RuntimeError(f"console create -> {status}: {body[:300]!r}")
        console_id = json.loads(body)["id"]
        log(f"console {console_id} created")
        try:
            self._request(
                "POST",
                f"/consoles/{console_id}/send/",
                json.dumps({"input": command + "\n"}).encode(),
                {"Content-Type": "application/json"},
            )
            deadline = time.time() + wait_seconds
            collected = ""
            while time.time() < deadline:
                status, body, _ = self._request(
                    "GET", f"/consoles/{console_id}/output/?length=20000", timeout=60
                )
                if status == 200:
                    collected += json.loads(body).get("output", "")
                    if re.search(r"__HDSAT_DONE__\d+", collected):
                        return collected
                time.sleep(4)
            return collected
        finally:
            self._request("DELETE", f"/consoles/{console_id}/")


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def remote_walk(pa: PA, root: str) -> list[dict]:
    """Every remote file under root (one tree call per directory)."""
    found: list[dict] = []
    pending = [root]
    seen: set[str] = set()
    while pending:
        directory = pending.pop()
        if directory in seen:
            continue
        seen.add(directory)
        for path in pa.tree(directory):
            if path.endswith("/"):
                pending.append(path.rstrip("/"))
            else:
                found.append({"path": path, "size": 0})
        time.sleep(0.4)
    return found


def mirror_files(pa: PA, remote_root: str, dest_root: str, manifest: dict) -> None:
    files = remote_walk(pa, remote_root)
    log(f"{len(files)} remote files under {remote_root}")
    total = sum(item["size"] for item in files)
    log(f"{total / 1024:.0f} KiB total")
    for index, item in enumerate(files, start=1):
        relative = os.path.relpath(item["path"], remote_root).replace("\\", "/")
        target = os.path.join(dest_root, relative.replace("/", os.sep))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        data = pa.download(item["path"])
        with open(target, "wb") as handle:
            handle.write(data)
        manifest["files"].append(
            {"path": relative, "bytes": len(data), "sha256": sha256(data)}
        )
        time.sleep(float(os.environ.get("HDSAT_PA_PAUSE", "0.8")))
        if index % 25 == 0:
            log(f"  {index}/{len(files)} downloaded")


def mirror_archive(pa: PA, remote_root: str, dest_root: str, manifest: dict) -> None:
    archive_path = "/tmp/hdsat-checkpoint.tgz"
    base = os.path.basename(remote_root.rstrip("/"))
    parent = os.path.dirname(remote_root.rstrip("/"))
    command = (
        f"cd {parent} && tar czf {archive_path} {base} "
        f"--exclude='__pycache__' --exclude='*.pyc' && ls -l {archive_path} "
        f"&& echo __HDSAT_DONE__$?"
    )
    log("building remote archive (one tar, then a single download)")
    output = pa.console(command)
    if "__HDSAT_DONE__0" not in output:
        raise RuntimeError(f"remote archive failed: {output[-600:]}")
    log("archive ready; downloading")
    data = pa.download(archive_path)
    local_archive = os.path.join(dest_root, os.pardir, "pythonanywhere-site.tgz")
    os.makedirs(os.path.dirname(local_archive), exist_ok=True)
    with open(local_archive, "wb") as handle:
        handle.write(data)
    log(f"downloaded {len(data) / 1024:.0f} KiB -> {os.path.relpath(local_archive, REPO)}")
    with tarfile.open(local_archive, "r:gz") as archive:
        archive.extractall(dest_root)
    manifest["archive"] = {
        "remote_path": archive_path,
        "bytes": len(data),
        "sha256": sha256(data),
        "local": os.path.relpath(local_archive, REPO),
    }
    for dirpath, _dirnames, filenames in os.walk(dest_root):
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            with open(full, "rb") as handle:
                chunk = handle.read()
            relative = os.path.relpath(full, dest_root).replace("\\", "/")
            manifest["files"].append(
                {"path": relative, "bytes": len(chunk), "sha256": sha256(chunk)}
            )
    pa.delete(archive_path)


def http_surface(dest_root: str, manifest: dict) -> None:
    """Record what a browser actually receives, plus the API payloads."""
    requests = [
        ("/", "index.html"),
        ("/api/health", "api/health.json"),
        ("/api/config", "api/config.json"),
        ("/api/legal", "api/legal.json"),
        ("/favicon.svg", "favicon.svg"),
        ("/manifest.webmanifest", "manifest.webmanifest"),
        ("/sw.js", "sw.js"),
    ]
    os.makedirs(os.path.join(dest_root, "http"), exist_ok=True)
    # The SPA's hashed bundle is only discoverable from index.html.
    status, body, _ = status_body_headers(f"{LIVE_ORIGIN}/")
    html = body.decode("utf-8", "replace")
    assets = re.findall(r'(?:src|href)="(/[^"]+)"', html)
    for asset in assets:
        requests.append((asset, "http" + asset))
    for path, local in requests:
        try:
            status, body, headers = status_body_headers(f"{LIVE_ORIGIN}{path}")
        except Exception as exc:  # noqa: BLE001 - record, never fail the snapshot
            manifest["http"].append({"path": path, "error": str(exc)[:160]})
            continue
        target = os.path.join(dest_root, local.replace("/", os.sep))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as handle:
            handle.write(body)
        manifest["http"].append(
            {
                "path": path,
                "status": status,
                "content_type": headers.get("Content-Type", ""),
                "bytes": len(body),
                "sha256": sha256(body),
            }
        )
    log(f"recorded {len(manifest['http'])} live HTTP responses")


def status_body_headers(url: str) -> tuple[int, bytes, dict]:
    request = urllib.request.Request(url, headers={"User-Agent": "hdsat-checkpoint/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.status, response.read(), dict(response.headers)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--discover", action="store_true", help="count remote files only")
    parser.add_argument("--archive", action="store_true", help="tar remotely, download once")
    parser.add_argument("--files", action="store_true", help="download file by file")
    parser.add_argument("--http", action="store_true", help="also snapshot the live HTTP surface")
    parser.add_argument("--remote", default=None, help="remote project root")
    parser.add_argument("--dest", default=None, help="local checkpoint directory")
    args = parser.parse_args()

    user, token = load_credentials()
    pa = PA(user, token)
    remote_root = args.remote or f"/home/{user}/HDSAT"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest_root = args.dest or os.path.join(REPO, "checkpoints", f"pythonanywhere-{stamp}")

    if args.discover:
        files = remote_walk(pa, remote_root)
        total = sum(item["size"] for item in files)
        directories = {os.path.dirname(item["path"]) for item in files}
        log(f"remote root {remote_root}")
        log(f"files: {len(files)}  directories: {len(directories)}  bytes: {total}")
        for item in files[:15]:
            log(f"  {item['size']:>9}  {item['path']}")
        return

    os.makedirs(dest_root, exist_ok=True)
    manifest: dict = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "remote_root": remote_root,
        "live_origin": LIVE_ORIGIN,
        "mode": "archive" if args.archive else "files",
        "files": [],
        "http": [],
    }
    if args.files:
        mirror_files(pa, remote_root, dest_root, manifest)
    else:
        mirror_archive(pa, remote_root, dest_root, manifest)
    if args.http:
        http_surface(dest_root, manifest)

    manifest["totals"] = {
        "files": len(manifest["files"]),
        "bytes": sum(item["bytes"] for item in manifest["files"]),
    }
    manifest_path = os.path.join(dest_root, "checkpoint-manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
    log(f"checkpoint at {os.path.relpath(dest_root, REPO)}")
    log(f"{manifest['totals']['files']} files, {manifest['totals']['bytes'] / 1024:.0f} KiB")
    log(f"manifest {os.path.relpath(manifest_path, REPO)}")


if __name__ == "__main__":
    main()
