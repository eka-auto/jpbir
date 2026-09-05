# MCP tools

`firestore_mcp.py` and `global_devices_mcp.py` are the MCP server entry points.
Their registration examples use the new locations in this repository.

The `_mcp_connect.py`, `_mcp_full_connect.py`, and `_mcp_sync.py` helpers import
the sibling server modules. These helpers issue live device commands when run;
they are not test scripts. Repository validation parses them without executing
their device operations.

Read-only diagnostic scripts are grouped separately in `tools/diagnostics/`.
