# S24 Connect MCP

Tracked source for the standalone Python MCP server formerly kept only at
`C:\Users\abcom\s24-connect-mcp\server.py`.

- Entry point: `server.py`
- Firestore project/database defaults: `intrepid-stage-495117-q1` / `eka-agent`
- Service-account key: supplied at runtime through `S24_SERVICE_ACCOUNT_KEY`
- Required Python packages: `mcp`, `cryptography`

No service-account JSON, bearer token, device secret, or private key belongs in
this directory. The default key path in `server.py` is only a local-development
fallback and the key itself remains outside Git.

The MCP process uses stdio and must remain local. It authenticates its Firestore
requests with the service account, but it does not add another caller-auth layer
around MCP tools. `device_ping` is read-only; command/wake tools write directly
to the Firestore command queue, so do not expose this process as an unauthenticated
network service.

The tracked phone counterpart is `Backend/s24_phone_direct_cloud.py`. It is
phone-only and fails closed with exit code 78 outside Android Termux.
