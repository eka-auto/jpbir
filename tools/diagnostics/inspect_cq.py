from google.oauth2 import service_account
from google.cloud.firestore_v1 import Client as FsClient

cred = service_account.Credentials.from_service_account_file(r'C:\eka-agent\agent\serviceAccountKey.json')
db = FsClient(project='intrepid-stage-495117-q1', database='eka-agent', credentials=cred)

d = db.collection('devices').document('samsung-s24-ultra').get().to_dict()
cq = d.get('commandQueue', {})
print(f'commandQueue has {len(cq)} entries')
for k, v in list(cq.items())[:10]:
    if isinstance(v, dict):
        print(f'  {k}: keys={list(v.keys())}, action={v.get("action")}, type={v.get("type")}')