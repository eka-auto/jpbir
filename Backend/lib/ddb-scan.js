// One bounded DynamoDB Scan, shared by every handler that reads the telemetry
// table.
//
// Four handlers scanned that table and three of them did it like this:
//
//     do { ...ScanCommand...; key = res.LastEvaluatedKey } while (key);
//
// byte-identical in jp-stats.js, jp-device.js and jp-agent.js: no page ceiling,
// no time budget, no signal to the caller that anything was cut short. The
// whole table came into the function on every request and grew without limit,
// so latency and payload scaled with total table size rather than with what was
// asked for, and the only thing that ever stopped it was the function timeout —
// a 504 with no explanation.
//
// jp-visitor.js had already worked this out and documented the reasoning. This
// is that implementation, moved here verbatim rather than reinvented, so the
// four call sites cannot drift apart again.
//
// This is still a Scan. Read capacity is unchanged and the real fix is a GSI on
// the access pattern; what this removes is the unbounded part.
import { ScanCommand } from '@aws-sdk/lib-dynamodb';

export const MAX_SCAN_PAGES = 200;
// A page ceiling alone does not stop a timeout — 200 sequential 1 MB Scans is
// far longer than the function's limit — so bound wall-clock too, and tell the
// caller when either limit cut the result short.
export const SCAN_BUDGET_MS = 8000;

/**
 * @param {object} client  DynamoDBDocumentClient
 * @param {string} table   table name
 * @param {object} [extra] extra ScanCommand input, e.g. a FilterExpression
 * @returns {Promise<{items: object[], truncated: boolean, pages: number}>}
 *   `truncated` is true when a limit stopped the scan before the table ended.
 *   Callers must surface it: a silently truncated total presented as a complete
 *   one is worse than an error, because nothing looks wrong.
 */
export async function scanBounded(client, table, extra) {
  const out = [];
  const start = Date.now();
  let key, pages = 0, truncated = false;
  do {
    const cmd = new ScanCommand({
      TableName: table,
      ...(extra || {}),
      ...(key ? { ExclusiveStartKey: key } : {}),
    });
    const res = await client.send(cmd);
    out.push(...(res.Items || []));
    key = res.LastEvaluatedKey;
    // Check BEFORE issuing the next page, not after it returns. Testing only
    // afterwards bounded the clock to the budget PLUS one more unbounded 1 MB
    // Scan, which on a cold or throttled table is exactly the overrun that
    // pushes the handler past its timeout and returns a 504.
    if (!key) break;
    if (++pages >= MAX_SCAN_PAGES || Date.now() - start > SCAN_BUDGET_MS) {
      truncated = true;
      break;
    }
  } while (key);
  return { items: out, truncated, pages };
}
