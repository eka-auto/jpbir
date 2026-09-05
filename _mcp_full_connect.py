import sys, os, json, time
sys.path.insert(0, r'C:\Samsung-S24')
os.environ['EKA_FIRESTORE_DB'] = 'eka-agent'

from firestore_mcp import s24_wakeup, s24_sync_now, s24_status, s24_queue_command, s24_read_calls, s24_read_sms, s24_read_location
from global_devices_mcp import ping_device, send_command, get_device

print('=' * 60)
print('MCP DEVICE CONNECTION — LIVE')
print('=' * 60)

# 1. WAKE + SYNC via MCP
print('[1] MCP WAKE:', s24_wakeup())
print('[2] MCP SYNC:', s24_sync_now())

# 2. PING + COMMAND via global-devices
print('[3] MCP PING:', ping_device('samsung-s24-ultra'))
print('[4] MCP SEND:', send_command('samsung-s24-ultra', 'sync-now', 'CRITICAL'))

# 3. QUEUE DATA COLLECTION via s24-cloud
print('[5] QUEUE DATA:')
for cmd in ['collect-calls', 'collect-sms', 'collect-location', 'collect-contacts']:
    print('   ', s24_queue_command(cmd)[:100])

# 4. WAIT FOR DAEMON TO PROCESS
print('\n[6] WAITING FOR DAEMON (20s)...')
for i in range(4):
    time.sleep(5)
    status = json.loads(s24_status())
    data = status.get('data', {})
    ds = data.get('samsungS24DirectSync', {})
    cq = data.get('commandQueue', {}) or {}
    pending = sum(1 for v in cq.values() if isinstance(v, dict) and v.get('status') == 'pending')
    completed = sum(1 for v in cq.values() if isinstance(v, dict) and v.get('status') == 'completed')
    seen = str(data.get('lastSeen', ''))[:19]
    print(f'  [{(i+1)*5}s] seen={seen} | pending={pending} | completed={completed}', flush=True)

# 5. READ ALL DATA
print('\n[7] CALLS:', s24_read_calls(20)[:400])
print('[8] SMS:', s24_read_sms(20)[:400])
print('[9] LOCATION:', s24_read_location()[:400])

# 6. DEVICE DETAIL
dev = json.loads(get_device('samsung-s24-ultra'))
print(f'\n[10] DEVICE: online={dev.get("online")} | status={dev.get("status")}')
print(f'     agent={dev.get("agentVersion")} | connection={dev.get("connectionMethod")}')
ds2 = dev.get('samsungS24DirectSync', {})
if isinstance(ds2, dict):
    calls2 = ds2.get('callLogs', [])
    if isinstance(calls2, str):
        try: calls2 = json.loads(calls2)
        except: calls2 = []
    sms2 = ds2.get('sms', [])
    if isinstance(sms2, str):
        try: sms2 = json.loads(sms2)
        except: sms2 = []
    print(f'     calls={len(calls2) if isinstance(calls2, list) else 0} | sms={len(sms2) if isinstance(sms2, list) else 0}')

print('=' * 60)
print('MCP CONNECTION COMPLETE')
print('=' * 60)
