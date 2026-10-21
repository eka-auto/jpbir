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
          "sha256": "1940ba363c2b88d6cae8eeecf14bda2479268122a65f8b548147201883f76977"
        }
      ],
      "digest": "sha256:bc7e03da432ab70a421a010840d021c4c70e7ec4a718f4002aa815ed9485fdfe"
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
          "sha256": "4d61438270e947c0a50c7bde195793d594a54e10b19247874d794b2c8e3f00a3"
        },
        {
          "path": "Database/scripts/_env.mjs",
          "sha256": "706080b96cd92e4395c5477f5550a9584bc493e0fa4fe1c4140f32abee693d77"
        },
        {
          "path": "Database/schema/004_whatsapp.sql",
          "sha256": "f25ec42030593266d3386c7fc4d9e38f24570495d3f583d0bd03600ab7a6a37e"
        },
        {
          "path": "Database/schema/005_s24_local_sync.sql",
          "sha256": "01936f08e7d3c6b112ebcc2543d2b971373a62bb73d1891b9f94e109c530d5d1"
        },
        {
          "path": "Database/schema/005_wa_attachments.sql",
          "sha256": "cb2b589ce971af6144120390578fdc776dab1a1214ede0c44d7df8c843bd10a4"
        },
        {
          "path": "Database/schema/006_s24_normalized.sql",
          "sha256": "0f045d0161ec8050a680d244c515cf8d57c0b71100adff76dfeff59fdcbcba23"
        },
        {
          "path": "Database/schema/007_clean_whatsapp_senders.sql",
          "sha256": "eb59214b2013f85b0f5da7f54bc9c3347e8efbec13628af15234c19bb3eec24b"
        },
        {
          "path": "Database/schema/008_wa_sync_attachment_counts.sql",
          "sha256": "f3e903db4afe8a430bf5cac55139533acf8700aca2ae7beabdd63bde3882716f"
        },
        {
          "path": "Database/schema/009_dynamodb_repair_state.sql",
          "sha256": "dd805179a9644ae2fa196b9537b92ef654c6b23d8e9ae598689187fc5452dc67"
        },
        {
          "path": "Database/schema/013_drop_telegram.sql",
          "sha256": "475f691c059c6fca102cac13950bd5829b6a398ca2733755861547169abb9eac"
        },
        {
          "path": "Database/schema/migration-aliases.json",
          "sha256": "123719c02d4a8a297e5e913b025f765fb4714ee44f44e8e719ebe03ebf320c4e"
        }
      ],
      "digest": "sha256:447d2da16624ce6fedbf31ce4eb2794fe921f778acc6ab4b9998d8463a0b6866"
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
