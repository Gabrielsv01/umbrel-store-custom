# Hermes Agent

To use it in Hermes, you need to create a bridge so that it recognizes it.

In the ```config.yaml``` file, the configuration should be like this:

```yaml
context7:
    command: python3
    args:
    - /opt/data/scripts/mcp-context7-bridge.py
```

The Python script is this:
You must change the PROXY_ID and HUB_BASE_URL to those configured on the network.

```python
import sys
import json
import asyncio
import httpx
from mcp.server.stdio import stdio_server
from mcp.server import Server
import mcp.types as types

# Config
HUB_BASE_URL = "http://10.0.0.10:5146"
PROXY_ID = "f824asd11fd67"
NAME = "context7-bridge"

async def forward_request(method, params):
    target_url = f"{HUB_BASE_URL}/api/stdio/proxy/{PROXY_ID}"
    async with httpx.AsyncClient() as client:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }
        response = await client.post(target_url, json=payload, timeout=30)
        return response.json()

async def main():
    server = Server(NAME)

    @server.list_tools()
    async def handle_list_tools():
        data = await forward_request("tools/list", {})
        tools_list = data.get("result", {}).get("tools", [])
        return [types.Tool(name=t["name"], description=t["description"], inputSchema=t["inputSchema"]) for t in tools_list]

    @server.call_tool()
    async def handle_call_tool(name: str, arguments: dict):
        data = await forward_request("tools/call", {"name": name, "arguments": arguments})
        return data.get("result", {})

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
```