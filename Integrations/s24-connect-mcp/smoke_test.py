"""Exercise real MCP stdio initialization and fail-closed ping using a fixture.

No credentials, cloud calls, device commands, or stored telemetry are used.
This catches SDK import/protocol regressions that source-string tests miss.
"""
import asyncio
import json
import os
from pathlib import Path
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


SERVER = Path(__file__).with_name("server.py")
FIXTURE_SERVER = """
import importlib.util, sys
spec = importlib.util.spec_from_file_location('s24_fixture', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module._get_doc = lambda device_id: {'deviceId': device_id, 'online': True}
def forbidden(*args, **kwargs):
    raise AssertionError('smoke test must not access a credential or mutate data')
module._get_token = forbidden
module._patch_doc = forbidden
module.mcp.run()
"""


async def verify():
    safe_env = {key: value for key, value in os.environ.items()
                if key.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "VIRTUAL_ENV"}}
    params = StdioServerParameters(command=sys.executable,
                                   args=["-c", FIXTURE_SERVER, str(SERVER)], env=safe_env)
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            tools = {tool.name for tool in (await session.list_tools()).tools}
            assert "device_ping" in tools
            result = await session.call_tool("device_ping", {"device_id": "samsung-s24-ultra"})
            assert not result.isError
            payload = json.loads(next(item.text for item in result.content if item.type == "text"))
            assert payload["connected"] is True
            assert payload["device_id"] == "samsung-s24-ultra"
            assert payload["device_online"] is False
            assert payload["heartbeat_authenticated"] is False
            assert payload["last_seen_age_seconds"] is None
            print("PASS: real MCP initialize, tools/list and read-only ping; missing heartbeat stays unverified")


if __name__ == "__main__":
    asyncio.run(asyncio.wait_for(verify(), timeout=20))
