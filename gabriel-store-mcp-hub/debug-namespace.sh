#!/bin/bash

echo "=== MCP Namespace Debug ==="
echo ""

# Check if mcp-wrapper-server.js exists
echo "1. Checking if mcp-wrapper-server.js exists..."
WRAPPER_FILE="/Users/gabriel.vieira/Documents/github/umbrel-store-custom/gabriel-store-mcp-hub/code/backend/mcp-wrapper-server.js"
if [ -f "$WRAPPER_FILE" ]; then
    echo "   ✓ File exists at: $WRAPPER_FILE"
    echo "   File size: $(stat -f%z "$WRAPPER_FILE") bytes"
else
    echo "   ✗ File NOT found at: $WRAPPER_FILE"
fi

echo ""
echo "2. Checking Docker containers with MCP label..."
docker ps -a --filter "label=gabriel.mcp-hub=true" --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "3. Looking for custom MCP containers..."
CUSTOM_CONTAINERS=$(docker ps -a --filter "label=gabriel.mcp-hub=true" --filter "name=mcp-custom" --format "{{.ID}}")
if [ -z "$CUSTOM_CONTAINERS" ]; then
    echo "   No custom MCP containers found"
else
    echo "   Found custom containers:"
    for CONTAINER_ID in $CUSTOM_CONTAINERS; do
        echo "   - $CONTAINER_ID"
        echo "     Status: $(docker inspect $CONTAINER_ID --format='{{.State.Status}}')"
        echo "     Running: $(docker inspect $CONTAINER_ID --format='{{.State.Running}}')"
        echo "     Ports:"
        docker inspect $CONTAINER_ID --format='{{json .NetworkSettings.Ports}}' | jq '.'

        echo ""
        echo "     Recent logs:"
        docker logs --tail 20 $CONTAINER_ID 2>&1 | head -10
    done
fi

echo ""
echo "4. Checking mcp data file..."
DATA_FILE="/Users/gabriel.vieira/Documents/github/umbrel-store-custom/gabriel-store-mcp-hub/code/backend/data/mcps.json"
if [ -f "$DATA_FILE" ]; then
    echo "   ✓ Data file exists"
    echo "   Custom MCPs in file:"
    cat "$DATA_FILE" | jq 'to_entries[] | select(.value.isCustomNamespace == true) | {key: .key, name: .value.name, port: .value.port, transport: .value.transport}'
else
    echo "   ✗ Data file not found"
fi

echo ""
echo "5. Checking localStorage data (from browser)..."
echo "   Note: This needs to be collected from browser dev tools"
echo "   localStorage['mcp_namespaces'] - namespaces created"
echo "   localStorage['custom_mcp_ids'] - IDs of deployed custom MCPs"

echo ""
echo "6. Testing HTTP connection to first custom container..."
if [ ! -z "$CUSTOM_CONTAINERS" ]; then
    FIRST_CONTAINER=$(echo "$CUSTOM_CONTAINERS" | head -1)
    PORT=$(docker inspect $FIRST_CONTAINER --format='{{json .NetworkSettings.Ports}}' | jq -r 'to_entries[0].value[0].HostPort // "8000"' 2>/dev/null || echo "8000")

    echo "   Testing container: $FIRST_CONTAINER on port $PORT"
    curl -s -X POST http://localhost:$PORT/mcp \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
        -m 5 | jq '.' || echo "   ✗ Connection failed"
else
    echo "   No containers to test"
fi

echo ""
echo "=== End Debug ==="
