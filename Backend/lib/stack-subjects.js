// GENERATED FILE — do not edit by hand.
//
// Produced by scripts/stack-subjects.mjs. Run that script after changing any
// file listed below, and commit the result together with the change. CI runs
// the same script in --check mode, so a subject edited without re-pinning it
// fails the build instead of leaving a panel row permanently unproven.
//
// The digests are the binding between a CI evidence receipt and the exact
// bytes it checked. See Backend/lib/stack-evidence.js.

export const SUBJECTS = {
    "runtime-contract": {
      "description": "S24 device runtime contract and the bundle it pins",
      "files": [
        {
          "path": "Devices/S24/runtime_contract.json",
          "sha256": "c18fa534cabf99e658a200a983b44fd88a0b1c3aa1babf69787262f72bd60fc3"
        },
        {
          "path": "Devices/S24/device_agent.py",
          "sha256": "7ebaed2f557373f959c1f52e44126ddbfdbd3974772dfd6bcf055a6dbd511519"
        },
        {
          "path": "Devices/S24/signer.py",
          "sha256": "64c56fa828dc56656ce6e28a116a43386781a1a0f737e5d794bec587db4927fa"
        },
        {
          "path": "Devices/S24/broker_client.py",
          "sha256": "e380867c5843e49c21d7e46704db20607389a9f1faad4b3cf61f9b4eab173bb1"
        },
        {
          "path": "Devices/S24/single_instance.py",
          "sha256": "287fe1c114488e847f0252c89170067e6fe5b33650780c72e8a8f00f7b63843a"
        },
        {
          "path": "Devices/S24/install_daemon.sh",
          "sha256": "3b4ba56b5612506b42627db84dff4bd79a0619d3a70fdb59eb9e2bd10b5fb75b"
        },
        {
          "path": "Devices/S24/s24-agent-daemon.mjs",
          "sha256": "7e9a14212a6052ea1ac7c1f9e7f8a6ae69e4c68bde7421001ec2398944a2cad4"
        },
        {
          "path": "Devices/S24/daemon/s24-agent-daemon.mjs",
          "sha256": "4af47d1cbff6b87096beae86fe14c9933613383174067fe5477d84e2af39d215"
        },
        {
          "path": "Devices/S24/requirements-broker.txt",
          "sha256": "37b13c7d746d596e7da6e73098dfba792eab1a49c8acc7e0a5ab287b56b107d5"
        }
      ],
      "digest": "sha256:225e8215cba5ecc143e3b60ca221b60f9f1b3af8aa86116b61766713ccb8224b"
    },
    "migration-tooling": {
      "description": "Migration runner, plan library and the schema it applies",
      "files": [
        {
          "path": "Database/scripts/migrate.mjs",
          "sha256": "e38006329821c8d9643605da70cf3c344a1727fb2769bc8f767bfd0572cceb7c"
        },
        {
          "path": "Database/scripts/lib/migration-plan.mjs",
          "sha256": "3da8b58502b56fb45065c8c83d0f0ffdb1be2e7ff6938cec3c30fffd3ae18564"
        },
        {
          "path": "Database/scripts/_env.mjs",
          "sha256": "706080b96cd92e4395c5477f5550a9584bc493e0fa4fe1c4140f32abee693d77"
        },
        {
          "path": "Database/schema/004_whatsapp.sql",
          "sha256": "a2cbb1b59c8e7dc7a8c10e9e143a80cf9bce413b61f97618555628ecf0940230"
        },
        {
          "path": "Database/schema/005_s24_local_sync.sql",
          "sha256": "0ca4a6318c96ba1140ee2c284a754e34d04bf310b933109b2425cbbace3e79b0"
        },
        {
          "path": "Database/schema/005_wa_attachments.sql",
          "sha256": "7f0ddd2b5ec189cd329e7ee684dc1066567c453813cbaaf4466a87b1ab23abdd"
        },
        {
          "path": "Database/schema/006_s24_normalized.sql",
          "sha256": "2f376fb3060a4d488db7fb243d8766f4a16c65352c11c2ed10b339088d212869"
        },
        {
          "path": "Database/schema/007_clean_whatsapp_senders.sql",
          "sha256": "3cbd3b125f94bdb8b9be99468450b4c3a75a45641261f4b0366798a8e8fd97de"
        },
        {
          "path": "Database/schema/008_wa_sync_attachment_counts.sql",
          "sha256": "d3a5fc74f0ae1a719b52e55458683d79ea221552965f399fc5dd34abab98cb64"
        },
        {
          "path": "Database/schema/009_dynamodb_repair_state.sql",
          "sha256": "554a1ab33433ccaeed631e4321d9aa7428a44d63e9ded0e59ba7fbf4bc7091ec"
        },
        {
          "path": "Database/schema/013_drop_telegram.sql",
          "sha256": "14ffdfabed2858feb5efbab9fad881d1240eb47f8bd57dcedbf3e121c24c8745"
        },
        {
          "path": "Database/schema/016_purge_non_birthday_analytics.sql",
          "sha256": "868c9fcdbd1836e63d7fd5783ca7028c7535ef534df97e313f7f4054486dfcf4"
        },
        {
          "path": "Database/schema/migration-aliases.json",
          "sha256": "123719c02d4a8a297e5e913b025f765fb4714ee44f44e8e719ebe03ebf320c4e"
        },
        {
          "path": "Database/schema/shared-ledger.json",
          "sha256": "a99f77de3f160e61087b38ac22de9ca37585c8696bf6ea3a715675e69e5bb74d"
        }
      ],
      "digest": "sha256:2fe209d6c214af8bcba3ae808e41d995288bf7039e12de05c63fbbf3fec76689"
    }
  };

// The facts the panel needs from the device runtime contract.
//
// They are lifted out of the contract file by the generator rather than
// copied into Backend/lib by hand, so the panel's expectation of the device
// cannot drift from the contract the device actually runs. The CI check
// re-reads the contract and fails if these values no longer match it.
export const S24_CONTRACT = {
    "device_id": "samsung-s24-ultra",
    "release": "s24-termux-broker-2026-09-21.2",
    "agent_version_prefix": "s24-termux-broker-",
    "connection_method": "signed-broker-v2",
    "job_scheduler_period_ms": 900000,
    "heartbeat_interval_seconds": 900
  };
