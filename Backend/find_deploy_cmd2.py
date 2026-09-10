from google.oauth2 import service_account
from google.cloud.firestore_v1 import Client as FsClient

cred = service_account.Credentials.from_service_account_file(r'C:\eka-agent\agent\serviceAccountKey.json')
db = FsClient(project='intrepid-stage-495117-q1', database='eka-agent', credentials=cred)

# Check the main document's commandQueue map
d = db.collection('devices').document('samsung-s24-ultra').get().to_dict()
cq = d.get('commandQueue', {})
for k, v in cq.items():
    if isinstance(v, dict):
        action = v.get('action') or v.get('type')
        if action and 'deploy' in str(action):
            print(f'commandQueue/{k}: action={action}')
            cmd = v.get('cmd', '')
            if cmd:
                print(f'  cmd: {cmd[:500]}')
            print()