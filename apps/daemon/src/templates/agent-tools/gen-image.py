#!/usr/bin/env python3
"""gen-image — CLI wrapper around the OGF daemon's /api/gen-image endpoint.

Why this exists:
  Agents like Claude Code, Gemini CLI, or any tool that doesn't have
  built-in image generation can still drive the OGF visual pipeline by
  shelling out to this script. The daemon owns the API keys (stored at
  ~/.ogf/secrets.json, mode 600) and routes to Gemini or OpenAI.

  Codex CLI users keep using Codex's built-in image_gen — this script is
  an ALTERNATE path, not a replacement.

Usage:
  python gen-image.py "<prompt>" <output.png> [options]

Options:
  --ref <path>           Reference image (multimodal). Can be repeated.
                         Gemini: passed inline as base64.
                         OpenAI: routes the call through /images/edits.
  --provider gemini|openai
                         Force a provider. Default: auto-pick (Gemini if
                         keyed, OpenAI fallback).
  --no-magenta-bg        Skip the "solid #FF00FF background" auto-inject.
                         Use this for backgrounds / scene art where you
                         want a normal image, NOT a chroma-key-ready sprite.
  --size <WxH>           Output size. OpenAI accepts only
                         1024x1024 / 1024x1536 / 1536x1024 / auto.
                         Gemini is flexible.
  --model <name>         Override the default model (gemini-2.5-flash-image
                         or gpt-image-1).
  --daemon <url>         Daemon base URL. Default: http://localhost:7621.

Exit codes:
  0  success
  1  invalid arguments / file errors
  2  daemon unreachable
  3  daemon returned an error (provider failure, missing key, etc.)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Generate an image via the OGF daemon (Gemini / OpenAI).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("prompt", help="The image prompt.")
    p.add_argument("output", help="Path to write the PNG (project-relative or absolute).")
    p.add_argument(
        "--ref",
        action="append",
        default=[],
        metavar="PATH",
        help="Reference image for multimodal. Can be repeated.",
    )
    p.add_argument(
        "--provider",
        choices=["gemini", "openai"],
        help="Force provider (default: auto, prefers Gemini).",
    )
    p.add_argument(
        "--no-magenta-bg",
        action="store_true",
        help="Disable the magenta-background auto-inject for sprites.",
    )
    p.add_argument("--size", help='Output size, e.g. "1024x1024".')
    p.add_argument("--model", help="Override default model.")
    p.add_argument(
        "--daemon",
        default=os.environ.get("OGF_DAEMON_URL", "http://localhost:7621"),
        help="Daemon base URL. Defaults to $OGF_DAEMON_URL or http://localhost:7621.",
    )
    return p.parse_args()


def to_absolute(p: str) -> str:
    """Daemon requires absolute paths. Resolve relative paths against CWD."""
    return str(Path(p).resolve())


def build_payload(args: argparse.Namespace) -> dict:
    payload = {
        "prompt": args.prompt,
        "outputPath": to_absolute(args.output),
        "magentaBg": not args.no_magenta_bg,
    }
    if args.ref:
        for ref in args.ref:
            if not Path(ref).exists():
                print(f"error: ref image not found: {ref}", file=sys.stderr)
                sys.exit(1)
        payload["refImagePaths"] = [to_absolute(r) for r in args.ref]
    if args.provider:
        payload["provider"] = args.provider
    if args.size:
        payload["size"] = args.size
    if args.model:
        payload["model"] = args.model
    return payload


def post(daemon_url: str, payload: dict) -> dict:
    url = daemon_url.rstrip("/") + "/api/gen-image"
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Daemon ran but returned non-2xx — print structured error body.
        try:
            err = json.loads(e.read().decode("utf-8"))
            msg = err.get("error", "unknown error")
            provider = err.get("provider", "?")
            ps = err.get("providerStatus")
            extra = f" (provider={provider}{', status=' + str(ps) if ps else ''})"
            print(f"error: gen-image failed: {msg}{extra}", file=sys.stderr)
        except Exception:
            print(f"error: gen-image http {e.code}: {e.reason}", file=sys.stderr)
        sys.exit(3)
    except urllib.error.URLError as e:
        print(
            f"error: cannot reach daemon at {daemon_url} — is it running? ({e.reason})",
            file=sys.stderr,
        )
        sys.exit(2)


def main() -> int:
    args = parse_args()
    payload = build_payload(args)
    result = post(args.daemon, payload)
    # Brief one-line success. The agent or shell can parse this if needed.
    print(
        f"ok: {result['path']} ({result['sizeBytes']} bytes, "
        f"provider={result['provider']}, model={result['model']})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
