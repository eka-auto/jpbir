# Supplied browser and library files: read-only review

All browser paths were resolved under the session's named D:\training-data root. No extracted credential was decrypted, tested, or used for account or device access. Source files were not modified and supplied extraction scripts were not executed.

| File group | Verified result |
| --- | --- |
| Login Data | 14 profile directories exist; 26 valid SQLite databases contain zero login rows. 24 databases are byte-identical. All 28 journals are empty. The data/local profile contains only journals. |
| Web Data | One valid database: 9 autofill rows, 3 address rows, no rows in local/masked card or stored-CVC tables. One payments_customer_data row and one token_service row were counted; values were not inspected. Both journals are empty; the data/local database is absent. |
| Cookie exports | Four actual JSONL exports, each containing 6 .google.com records named _ga, _ga_3BQTD98D97, and NID. Three exports store encrypted placeholders; data/chrome_forensic_output/cookies_decrypted.jsonl stores non-placeholder values whose correctness was not validated. Two cookies.jsonl exports are byte-identical. Four cache counterparts are .metadata files. No listed device connection field was present. |
| Password summaries | Two identical 2,682-byte files. Each contains two nonempty password-labelled fields and narrative about encrypted/hash material. The summary claims and credential validity are unverified. One cache counterpart is .metadata only. |
| Extraction script | One 11,503-byte Python source file statically attempts Chrome login/cookie extraction and DPAPI/AES-GCM decryption, with potentially sensitive output. It was not executed. One cache counterpart is .metadata only. |
| OAuthlib text copies | ClientCredentialsGrant and ResourceOwnerPasswordCredentialsGrant implementation code. Static inspection found no sensitive named string-literal assignments, private-key markers, or searched S24 connection terms. |

These files do not establish a live S24 connection. Inspection of populated SQLite tables does not establish whether deleted records exist in unused pages.

## Metadata reports

- [Login databases](login-metadata-20260905T215132Z.json)
- [Web Data and cookie exports](web-cookie-metadata-20260905T215456Z.json)
- [Password summaries and script](password-summary-metadata-20260906.json)
- [OAuthlib files](oauthlib-metadata-20260905T215704Z.json)
