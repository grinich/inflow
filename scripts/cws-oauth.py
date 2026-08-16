#!/usr/bin/env python3
"""Run the Chrome Web Store OAuth flow and return a refresh token.

Google blocked the out-of-band flow (``urn:ietf:wg:oauth:2.0:oob``) that the
docs used to describe, so this uses the loopback redirect that replaced it: a
one-shot HTTP server on 127.0.0.1 catches the callback, which means the
authorization code never has to be copied out of the browser by hand.

Reads a JSON object on stdin::

    {"client_id": "...", "client_secret": "...", "extension_id": "..."}

Writes a JSON object on stdout::

    {"ok": true, "refresh_token": "..."}
    {"ok": false, "error": "..."}

Progress goes to stderr so stdout stays parseable. Credentials arrive on stdin
and leave on stdout, never through argv or the environment, so they stay out of
the process list.
"""

from __future__ import annotations

import json
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/chromewebstore"
TIMEOUT_SECONDS = 300

DONE_PAGE = b"""<!doctype html><meta charset="utf-8">
<title>inflow</title>
<style>
  body{font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       display:grid;place-items:center;height:100vh;margin:0;
       background:#fbfbfc;color:#0b0d12}
  @media (prefers-color-scheme:dark){body{background:#08090b;color:#f5f6f8}}
  p{color:#565c66}
  @media (prefers-color-scheme:dark){p{color:#a2a8b3}}
</style>
<div style="text-align:center">
  <h1 style="font-weight:600;letter-spacing:-.03em">Authorized</h1>
  <p>You can close this tab and return to the terminal.</p>
</div>
"""

FAILED_PAGE = b"""<!doctype html><meta charset="utf-8">
<title>inflow</title>
<body style="font:16px -apple-system,sans-serif;padding:3rem">
Authorization failed. Return to the terminal for details.
"""


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def emit(payload: dict) -> None:
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


def post_form(url: str, fields: dict) -> dict:
    body = urllib.parse.urlencode(fields).encode()
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read())
        except Exception:
            return {"error": f"HTTP {exc.code}"}


def get_json(url: str, headers: dict) -> dict:
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read())
        except Exception:
            return {"error": {"message": f"HTTP {exc.code}"}}


class CallbackHandler(BaseHTTPRequestHandler):
    result: dict = {}

    def do_GET(self) -> None:  # noqa: N802 — required by BaseHTTPRequestHandler
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        CallbackHandler.result = {k: v[0] for k, v in query.items()}
        ok = "code" in CallbackHandler.result
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(DONE_PAGE if ok else FAILED_PAGE)

    def log_message(self, *_args) -> None:
        """Silence the default per-request stderr logging."""


def run(config: dict) -> dict:
    client_id = config.get("client_id", "").strip()
    client_secret = config.get("client_secret", "").strip()
    extension_id = config.get("extension_id", "").strip()
    if not client_id or not client_secret:
        return {"ok": False, "error": "client_id and client_secret are required"}

    # Port 0 lets the OS pick. Loopback redirects accept any port without being
    # registered on the client, which is exactly why they replaced OOB.
    server = HTTPServer(("127.0.0.1", 0), CallbackHandler)
    server.timeout = TIMEOUT_SECONDS
    redirect_uri = f"http://127.0.0.1:{server.server_port}"
    state = secrets.token_urlsafe(24)

    auth_url = AUTH_ENDPOINT + "?" + urllib.parse.urlencode(
        {
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": SCOPE,
            "state": state,
        }
    )

    log("")
    log("  Sign in as the Google account that OWNS the store listing.")
    log("  If your browser does not open, paste this in yourself:")
    log("")
    log(f"  {auth_url}")
    log("")
    try:
        webbrowser.open(auth_url)
    except Exception:
        pass

    log(f"  Waiting for the callback on {redirect_uri} ...")
    server.handle_request()
    server.server_close()

    callback = CallbackHandler.result
    if not callback:
        return {"ok": False, "error": f"No callback within {TIMEOUT_SECONDS}s."}
    if "error" in callback:
        return {"ok": False, "error": f"Authorization denied: {callback['error']}"}
    if callback.get("state") != state:
        return {"ok": False, "error": "State mismatch — ignoring the callback."}

    log("  Got the code, exchanging it ...")
    tokens = post_form(
        TOKEN_ENDPOINT,
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": callback["code"],
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
    )
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        detail = tokens.get("error_description") or tokens.get("error") or "no refresh_token returned"
        return {"ok": False, "error": f"Token exchange failed: {detail}"}

    if extension_id:
        log("  Checking the token can reach the listing ...")
        item = get_json(
            f"https://www.googleapis.com/chromewebstore/v1.1/items/{extension_id}?projection=DRAFT",
            {"Authorization": f"Bearer {tokens.get('access_token', '')}", "x-goog-api-version": "2"},
        )
        if item.get("id") != extension_id:
            err = item.get("error", item)
            detail = err.get("message") or err.get("error_description") or str(err)[:300]
            return {
                "ok": False,
                "error": (
                    f"That account cannot publish {extension_id}: {detail}\n"
                    "  Usually this means a different Google account than the listing's owner."
                ),
            }

    return {"ok": True, "refresh_token": refresh_token}


def main() -> int:
    try:
        config = json.load(sys.stdin)
    except Exception as exc:
        emit({"ok": False, "error": f"Could not read config from stdin: {exc}"})
        return 1

    try:
        result = run(config)
    except KeyboardInterrupt:
        emit({"ok": False, "error": "Cancelled."})
        return 1

    emit(result)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
