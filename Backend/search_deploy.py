from google.oauth2 import service_account
from google.cloud.firestore_v1 import Client as FsClient

cred = service_account.Credentials.from_service_account_file(r'C:\eka-agent\agent\serviceAccountKey.json')
db = FsClient(project='intrepid-stage-495117-q1', database='eka-agent', credentials=cred)

d = db.collection('devices').document('samsung-s24-ultra').get().to_dict()
cq = d.get('commandQueue', {})
for k, v in cq.items():
    if isinstance(v, dict):
        action = str(v.get('action') or v.get('type') or '').lower()
        if 'deploy' in action or 'agent' in action:
            print(f'{k}: action={v.get("action")} type={v.get("type")}')
            cmd = v.get('cmd', '')
            if cmd:
                print(cmd[:3000])
            print()