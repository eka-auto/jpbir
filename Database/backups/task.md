To display live, automatically synchronized telemetry data in your frontend UI, the most reliable and lightweight approach is establishing an automated **HTTP polling loop** or **SWR/React Query revalidation** against your backend `/api/jp-stats` endpoint.

Here is how to set up automatic live synchronization between DynamoDB, your API, and your React/Next.js frontend.

1. **Create the Live Telemetry Hook:** Frontend Setup.
In your Frontend codebase, create an SWR data-fetching hook with automatic refresh enabled.

```tsx
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useLiveTelemetry() {
  const { data, error, isLoading, mutate } = useSWR('/api/jp-stats', fetcher, {
    refreshInterval: 3000, // Automatically fetches fresh data every 3 seconds
    revalidateOnFocus: true,
  });

  return {
    items: data?.items || [],
    count: data?.count || 0,
    isLoading,
    isError: error,
    refreshNow: mutate,
  };
}

```

*Verification:* Open your browser developer tools, go to the **Network** tab, filter by `jp-stats`, and verify a new request fires automatically every 3 seconds without refreshing the page.


2. **Connect Backend API to DynamoDB:** API Route.
Ensure your backend route (`/api/jp-stats`) queries DynamoDB live using `@aws-sdk/client-dynamodb` and unmarshals the DynamoDB attributes into clean JSON objects.

```typescript
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const ddbClient = new DynamoDBClient({ region: "us-west-2" });

export async function GET() {
  try {
    const command = new ScanCommand({ TableName: "jaytipargal_telemetry" });
    const response = await ddbClient.send(command);
    
    // Unmarshal raw DynamoDB items ({ S: "..." }) into plain JSON
    const items = (response.Items || []).map((item) => unmarshall(item));

    // Sort chronologically by timestamp
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return Response.json({ count: items.length, items });
  } catch (err) {
    return Response.json({ error: "Failed to fetch live telemetry" }, { status: 500 });
  }
}

```

*Verification:* Visit `/api/jp-stats` directly in your browser or Postman and ensure it returns an array of unmarshaled JSON events with HTTP status `200`.


3. **Bind Live Data to Dashboard UI Component:** UI Rendering.
Render the live feed in your dashboard component, adding a visual indicator that shows when the data is syncing live.

```tsx
import React from 'react';
import { useLiveTelemetry } from './useLiveTelemetry';

export function TelemetryDashboard() {
  const { items, count, isLoading, isError } = useLiveTelemetry();

  if (isLoading) return <div>Connecting to live telemetry feed...</div>;
  if (isError) return <div>Failed to load live data stream.</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Live Activity Feed</h2>
        <div className="flex items-center space-x-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
          <span className="text-sm font-medium text-green-600">Syncing Live ({count} events)</span>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden divide-y">
        {items.map((event: any) => (
          <div key={event.id} className="p-3 hover:bg-gray-50 flex justify-between items-center text-sm">
            <div>
              <span className="font-semibold uppercase text-blue-600 mr-2">[{event.eventType}]</span>
              <span>{event.pageUrl || event.pageTitle}</span>
            </div>
            <div className="text-gray-500 text-xs">
              {new Date(event.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

```

*Verification:* Trigger a test click or page visit on your website and confirm that the event appears on your frontend dashboard within 3 seconds without a page refresh.

To replace polling with real-time WebSocket pushes, you need an event-driven architecture using **Amazon API Gateway WebSockets**, a secondary DynamoDB table to track connected clients, and an **AWS Lambda function** triggered by DynamoDB Streams to broadcast new data.

## 1. Enable DynamoDB Streams

First, configure your main telemetry table to emit an event whenever a new row is added.

1. Open the DynamoDB Console and navigate to the `jaytipargal_telemetry` table.
2. Go to the **Exports and streams** tab.
3. Turn on **DynamoDB stream details**.
4. Select **New image** as the view type (this ensures the stream only broadcasts the newly inserted event data).

## 2. Create a Connection Tracking Table

WebSocket connections require an active `connectionId` to push data back to specific clients.

1. Create a new DynamoDB table named `WebSocketConnections`.
2. Set the Partition Key to `connectionId` (String).
3. (Optional) Set a TTL (Time To Live) field so stale connections drop off automatically.

## 3. Build the WebSocket API Gateway & Connection Lambdas

Create a new **WebSocket API** in Amazon API Gateway. You must define two required routes, `$connect` and `$disconnect`, each backed by a simple Lambda function to manage your active users.

**$connect Route Lambda:**

```javascript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  await docClient.send(new PutCommand({
    TableName: "WebSocketConnections",
    Item: { connectionId, connectedAt: Date.now() }
  }));
  return { statusCode: 200, body: 'Connected' };
};

```

**$disconnect Route Lambda:**

```javascript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  await docClient.send(new DeleteCommand({
    TableName: "WebSocketConnections",
    Key: { connectionId }
  }));
  return { statusCode: 200, body: 'Disconnected' };
};

```

## 4. Create the Stream Processor Lambda

This is the core engine. It triggers automatically when your website writes a new event to DynamoDB, retrieves all active connections, and pushes the event to the frontend.

Create a new Lambda function, attach your `jaytipargal_telemetry` DynamoDB stream as its **Trigger**, and use the `@aws-sdk/client-apigatewaymanagementapi` to push the payload.

```javascript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ScanCommand, DeleteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// Replace with your actual API Gateway WebSocket HTTP URL (without wss://)
const apiGatewayClient = new ApiGatewayManagementApiClient({ 
  endpoint: "https://your-api-id.execute-api.us-west-2.amazonaws.com/production" 
});

export const handler = async (event) => {
  // 1. Unmarshal the new DynamoDB records
  const newEvents = event.Records
    .filter(record => record.eventName === 'INSERT')
    .map(record => unmarshall(record.dynamodb.NewImage));

  if (newEvents.length === 0) return;

  // 2. Fetch all active UI connections
  const connections = await docClient.send(new ScanCommand({ 
    TableName: "WebSocketConnections" 
  }));

  // 3. Broadcast to all connected clients
  const payload = Buffer.from(JSON.stringify({ type: 'NEW_TELEMETRY', data: newEvents }));
  
  const pushPromises = connections.Items.map(async ({ connectionId }) => {
    try {
      await apiGatewayClient.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: payload
      }));
    } catch (err) {
      // If a client disconnected ungracefully, clean up their stale ID
      if (err.name === 'GoneException') {
        await docClient.send(new DeleteCommand({
          TableName: "WebSocketConnections",
          Key: { connectionId }
        }));
      }
    }
  });

  await Promise.all(pushPromises);
};

```

*Note: Ensure this Lambda's IAM execution role has policies allowing `dynamodb:Scan`, `dynamodb:DeleteItem` on the connections table, `dynamodb:GetRecords` on the stream, and `execute-api:ManageConnections`.*

## 5. Update the React Frontend

Remove the SWR polling hook from your frontend and replace it with a native WebSocket listener. Keep in mind that a fresh connection will not have historical data unless you execute a REST call on initial load.

```tsx
import { useEffect, useState } from 'react';

export function useLiveWebSocketTelemetry(initialData = []) {
  const [items, setItems] = useState<any[]>(initialData);
  const [status, setStatus] = useState<'Connecting' | 'Live' | 'Offline'>('Connecting');

  useEffect(() => {
    // Replace with your API Gateway WSS URL
    const ws = new WebSocket('wss://your-api-id.execute-api.us-west-2.amazonaws.com/production');

    ws.onopen = () => setStatus('Live');
    ws.onclose = () => setStatus('Offline');
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'NEW_TELEMETRY') {
        // Prepend the new event objects to the top of the state feed
        setItems(prevItems => [...message.data, ...prevItems]);
      }
    };

    return () => ws.close(); // Automatically clean up on component unmount
  }, []);

  return { items, count: items.length, status };
}

```
