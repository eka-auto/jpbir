import sys, os, json, time

# firestore_mcp / global_devices_mcp are NOT siblings of this script: this file
# is in Backend/ and firestore_mcp.py is in Database/. Put that layer on the
# path explicitly. Relying on a sibling is what broke when the repo moved to a
# layered layout, and it fails at run time, not import-check time.
_LAYERS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _layer in ("Database", "Backend"):
    _p = os.path.join(_LAYERS, _layer)
    if _p not in sys.path:
        sys.path.insert(0, _p)
os.environ['EKA_FIRESTORE_DB'] = 'eka-agent'
from firestore_mcp import s24_queue_command, s24_status, s24_read_calls, s24_read_sms, s24_read_location

print('QUEUEING COMMANDS...')
print(s24_queue_command('sync-now'))
print(s24_queue_command('collect-calls'))
print(s24_queue_command('collect-sms'))
print(s24_queue_command('collect-location'))

print('\nWAITING 20s FOR DAEMON...')
time.sleep(20)

print('\nSTATUS:')
s = json.loads(s24_status())
d = s.get('data', {})
ds = d.get('samsungS24DirectSync', {})
cq = d.get('commandQueue', {}) or {}
pending = sum(1 for v in cq.values() if isinstance(v, dict) and v.get('status') == 'pending')
completed = sum(1 for v in cq.values() if isinstance(v, dict) and v.get('status') == 'completed')
print(f'  lastSeen: {str(d.get("lastSeen", ""))[:19]}')
print(f'  syncedAt: {str(ds.get("syncedAt", ""))[:19]}')
print(f'  payload:  {ds.get("payloadStatus")}')
print(f'  pending:  {pending}')
print(f'  completed:{completed}')

print('\nCALLS:')
print(s24_read_calls(10)[:300])
print('\nSMS:')
print(s24_read_sms(10)[:300])
print('\nLOCATION:')
print(s24_read_location()[:300])
