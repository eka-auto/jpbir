# S24 daemon variants

The repository-root daemon files now live here:

| Previous path | Current path |
| --- | --- |
| `s24-agent-daemon.mjs` | `Sandbox/S24/daemon/s24-agent-daemon.mjs` |
| `s24-agent-daemon.js` | `Sandbox/S24/daemon/legacy/s24-agent-daemon.js` |
| `#!usrbinenv node.js` | `Sandbox/S24/daemon/legacy/s24-agent-daemon-original.mjs` |

The legacy files retain the earlier imported implementations. The unusual
`#!usrbinenv node.js` filename came from an imported script and has been renamed
to describe its contents. No daemon variant was deleted or combined.

The existing install kit uses `Sandbox/S24/s24-agent-daemon.mjs`, which remains
beside `install_daemon.sh`. The daemon in this directory is a separate variant.
See [the architecture notes](../DAEMON_ARCHITECTURE.md) for background.

This reorganization does not install, start, or replace a running device daemon.
