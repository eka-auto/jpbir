# Read-only folder inspection

Source: `C:\Users\abcom\OneDrive\Desktop\Sensitive file contents - 20260906-021101`

## Verified outcome

The folder contains **13,809 files, 2,301,954,908 bytes (2.30 GB)**. The extracted files are incomplete compared with the included manifest, but every exported copy that is present matches its recorded SHA-256 hash. No phone connection was established by this inspection.

| Manifest comparison | Originals | UTF-8 text copies |
| --- | ---: | ---: |
| Expected entries | 15,304 | 2,028 |
| Present and SHA-256 verified | 11,791 | 2,014 |
| Missing extracted files | 3,513 | 14 |
| Hash mismatches among present copies | 0 | 0 |

The remaining four files are root export metadata and the combined readable text. Two independent directory enumerations agreed on the current count. Missing entries have distinct destination paths, so this difference is not caused by duplicate manifest destinations. Missing originals comprise 3,506 browser-profile files and 7 dependency/cache files; missing text copies comprise 7 from each category. The historical export summary marks its export complete; that does not establish completeness of the current extracted folder. Missing text content may also be represented in the combined readable text; it was not recovered or reconstructed during this review.

## Browser and application findings

| Data | Observed result |
| --- | --- |
| Login databases | 30 original Login Data / Login Data For Account files; every login table has zero records. |
| Autofill | Three byte-identical Web Data copies, each with 9 autofill rows and 3 address rows. Card and IBAN tables are empty. |
| Cookie databases | 21 files with 6 distinct contents. 3,666 rows counting file copies; 1,222 summed across distinct database contents. These counts do not establish unique cookies, validity, or usable sessions. |
| Browser journals | 80 journals, all zero bytes; no corresponding WAL/SHM files found. |
| Browser integrity | 54 database copies with 10 distinct contents; all distinct representatives pass SQLite quick_check. |
| Account-export JSON | eka-runner_users.json has 8 user records, including 6 nonempty password-hash/salt pairs. A separate jp_initial_user.json contains one nonempty password field. These are content observations; credentials were not tested. |
| Password summaries | One distinct summary content repeated in 10 original/text copies; two nonempty password-labelled fields per copy. Claims and validity remain unverified. |
| Other application files | 90 original/text files outside browser and dependency/cache directories reduce to 12 distinct file contents. They include extraction/access scripts, package files, cookie exports, account exports, and a page/content dump. Scripts were not executed. |

## S24 connection review and scope

A case-insensitive scan of 1,263 text copies outside dependency/cache directories, totaling 73,655,639 bytes, found no matching push-token, SSH/tunnel, S24 queue/heartbeat, Termux-installation, or canonical-project markers. The 12 distinct application contents likewise contained no matching push-token, tunnel, queue, or Firestore fields. A generic S24 name reference in an IMAP script does not establish a remote phone endpoint.

This was a file inspection, not a live device probe. Binary/encrypted content was not decrypted, deleted SQLite records were not recovered, extracted credentials were not used, and source scripts were not run. Original source paths embedded in metadata were not followed outside the supplied folder. Credential, cookie, and payment values are omitted from the reports. No source files were modified.

## Evidence reports

- [Full file inventory](folder-inventory-20260905T215800Z.json)
- [Export provenance and file-size comparison](export-provenance-review-20260906.json)
- [SHA-256 verification and complete missing-file list](folder-manifest-integrity-20260906.json)
- [Browser database counts](folder-browser-db-review-20260906.json)
- [Application content groups and redacted field counts](folder-application-review-20260905T215935Z.json)
- [Connection marker scan](folder-connection-marker-review-20260906.json)
