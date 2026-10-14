# S24 Connect MCP

Tracked source for the standalone Python MCP server formerly kept only at
`C:\Users\abcom\s24-connect-mcp\server.py`.

- Entry point: `server.py`
- Firestore project/database defaults: `intrepid-stage-495117-q1` / `eka-agent`
- Service-account key: supplied at runtime through `S24_SERVICE_ACCOUNT_KEY`
- Runtime dependencies: install the pinned `requirements.txt` into a dedicated
  virtual environment. Do not use an unversioned global `mcp` installation.

## Isolated runtime and startup verification

The server uses `mcp.server.fastmcp.FastMCP` from SDK v1. A shared interpreter
upgrade to SDK v2 removes that module and prevents MCP initialization, even
when Firestore and the dashboard are healthy. `requirements.txt` pins the
compatible SDK and validation packages; unrelated MCP runtimes stay untouched.

```powershell
python -m venv C:\path\to\s24-mcp-venv
C:\path\to\s24-mcp-venv\Scripts\python.exe -m pip install -r Integrations/s24-connect-mcp/requirements.txt
C:\path\to\s24-mcp-venv\Scripts\python.exe Integrations/s24-connect-mcp/smoke_test.py
```

Configure the MCP server's `command` to that environment's interpreter, keeping
its existing script arguments and credential environment unchanged. Restart
the MCP host to reload its configuration. The smoke test starts a real stdio
server with synthetic device metadata, forbids credential access and writes,
and verifies that a stored online flag without heartbeat evidence stays false.
CI runs it on Python 3.12 and 3.14 without production credentials.

No service-account JSON, bearer token, device secret, or private key belongs in
this directory. The default key path in `server.py` is only a local-development
fallback and the key itself remains outside Git.

The MCP process uses stdio and must remain local. It authenticates its Firestore
requests with the service account, but it does not add another caller-auth layer
around MCP tools. `device_ping` is read-only; command/wake tools write directly
to the Firestore command queue, so do not expose this process as an unauthenticated
network service.

The MCP and `Devices/S24/pull_direct_cloud.py` accept both known phone build
families (`s24-termux-` and `s24-direct-cloud-`) only when the remaining
Android/Termux attestation fields pass.

The tracked phone counterpart is `Backend/s24_phone_direct_cloud.py`. It is
phone-only and fails closed with exit code 78 outside Android Termux.
