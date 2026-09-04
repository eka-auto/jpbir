import sys, os, json, time
sys.path.insert(0, r'C:\Samsung-S24')
os.environ['EKA_FIRESTORE_DB'] = 'eka-agent'

from firestore_mcp import (
    s24_wakeup, s24_sync_now, s24_status, s24_queue_command,
    s24_read_calls, s24_read_sms, s24_read_location
)

print('=' * 60)
print('MCP DEVICE CONNECTION')
print('=' * 60)

# 1. WAKEUP
print('\n[1] WAKE:', s24_wakeup())

# 2. SYNC
print('[2] SYNC:', s24_sync_now())

# 3. QUEUE FULL DATA COLLECTION
print('[3] QUEUE:')
cmds = ['sync-now', 'collect-calls', 'collect-sms', 'collect-location', 'collect-whatsapp']
for c in cmds:
    result = s24_queue_command(c)
    print(f'     {c}: {result[:80]}...')

# 4. POLL FOR DAEMON TO PROCESS
print('\n[4] POLLING 30s:')
for i in range(6):
    time.sleep(5)
    status = json.loads(s24_status())
    data = status.get('data', {})
    ds = data.get('samsungS24DirectSync', {})
    cq = data.get('commandQueue', {}) or {}
    pending = sum(1 for v in cq.values() if isinstance(v, dict) and v.get('status') in ('pending', 'queued', 'requested'))
    completed = sum(1 for v in cq.values() if isinstance(v, dict) and v.get('status') == 'completed')
    seen = str(data.get('lastSeen', ''))[:19]
    print(f'  [{(i+1)*5}s] seen={seen} pending={pending} completed={completed}', flush=True)

# 5. READ DATA
print('\n[5] CALLS:', s24_read_calls(10)[:300])
print('[6] SMS:', s24_read_sms(10)[:300])
print('[7] LOCATION:', s24_read_location()[:300])

# 6. FINAL STATUS
final = json.loads(s24_status())
data = final.get('data', {})
ds = data.get('samsungS24DirectSync', {})
print(f'\n[8] DEVICE: online={data.get("online")} status={data.get("status")}')
print(f'     lastSeen={str(data.get("lastSeen",""))[:19]} syncedAt={str(ds.get("syncedAt",""))[:19]}')
print(f'     payload={ds.get("payloadStatus")} agent={data.get("agentVersion")}')
print('=' * 60)
print('MCP CONNECTED')
print('=' * 60)
