// Every device installer verifies its own bundled files by hash and aborts on
// mismatch, so a wrong pin is not a cosmetic defect - it is an installer that can
// never run. Two of the three were exactly that:
//
//   Devices/Vivobook/install_vivobook.ps1 pinned single_instance.py to
//   334F103E2D7175A340D65E95011D59531E1940E5 - `git hash-object` output, a
//   40-character SHA-1 blob id, compared against (Get-FileHash -Algorithm SHA256).Hash
//   which is 64 characters. It could not match for ANY file content.
//   Devices/Lenovo/install_lenovo.ps1 pinned a well-formed SHA-256 of an older
//   generation of the same file, and failed identically.
//
// Both threw at the integrity check, before the venv, enrollment and scheduled task
// were reached - which is consistent with jayti-asus-vivobook having never written a
// telemetry field and g4g-lenovo-laptop running a non-kit agent.
//
// Devices/sandbox/tests/test_deploy_kits.py now checks both byte relationships and the
// S24 pin table, while this suite independently parses all three installers. The length
// assertion alone catches the SHA-1 mistake, which is why it runs before any hashing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANONICAL = join(ROOT, 'Devices', 'sandbox');

// The broker artifacts every kit bundles. The S24 device agent is now an Android-specific
// release while the remaining core stays shared. Not all files are hash-verified
// by every installer: S24 installs
// its Python dependency inline (`pip install 'requests==2.34.2'`, install_s24.sh:64)
// rather than verifying requirements-broker.txt, so it pins four, not five.
const CORE = ['device_agent.py', 'broker_client.py', 'signer.py', 'single_instance.py'];
const SHARED_CORE = ['broker_client.py', 'signer.py', 'single_instance.py'];

const INSTALLERS = [
  {
    kit: 'Lenovo',
    file: 'Devices/Lenovo/install_lenovo.ps1',
    // [pscustomobject]@{ Name = 'x'; Hash = 'ABC' }
    pattern: /Name\s*=\s*'([^']+)'\s*;\s*Hash\s*=\s*'([0-9A-Fa-f]+)'/g,
    expected: [...CORE, 'requirements-broker.txt'],
  },
  {
    kit: 'Vivobook',
    file: 'Devices/Vivobook/install_vivobook.ps1',
    pattern: /Name\s*=\s*'([^']+)'\s*;\s*Hash\s*=\s*'([0-9A-Fa-f]+)'/g,
    expected: [...CORE, 'requirements-broker.txt'],
  },
  {
    kit: 'S24',
    file: 'Devices/S24/install_s24.sh',
    // install_verified 'x' 'abc'
    pattern: /install_verified\s+'([^']+)'\s+'([0-9A-Fa-f]+)'/g,
    expected: [...CORE],
  },
];

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function pins(installer) {
  const src = readFileSync(join(ROOT, installer.file), 'utf8');
  const found = new Map();
  for (const m of src.matchAll(installer.pattern)) found.set(m[1], m[2]);
  return found;
}

t('every installer pins the artifacts it is expected to', () => {
  for (const installer of INSTALLERS) {
    const found = pins(installer);
    assert.ok(found.size > 0, `${installer.file}: no pins parsed - the regex stopped matching`);
    assert.deepEqual([...found.keys()].sort(), [...installer.expected].sort(),
      `${installer.file} pins the wrong artifact set`);
    for (const name of CORE) {
      assert.ok(found.has(name), `${installer.kit} does not hash-verify ${name}`);
    }
  }
});

t('every pin is 64 hex characters, not a git object id', () => {
  // Catches the Vivobook bug on shape alone, before any hashing: a SHA-1 blob id is
  // 40 characters and can never equal a 64-character SHA-256 digest.
  for (const installer of INSTALLERS) {
    for (const [name, hash] of pins(installer)) {
      assert.equal(hash.length, 64,
        `${installer.kit}/${name} pin is ${hash.length} chars, not 64 - a git blob SHA-1 ` +
        `pasted into a SHA-256 field`);
      assert.match(hash, /^[0-9a-fA-F]{64}$/, `${installer.kit}/${name} is not hex`);
    }
  }
});

t('every pin matches the bytes actually bundled in that kit', () => {
  for (const installer of INSTALLERS) {
    for (const [name, hash] of pins(installer)) {
      const bundled = join(ROOT, 'Devices', installer.kit, name);
      assert.ok(existsSync(bundled), `${installer.kit}/${name} is pinned but not bundled`);
      assert.equal(hash.toLowerCase(), sha256(bundled),
        `${installer.kit}/${name} pin does not match the bundled file - the installer ` +
        `aborts at its integrity check and never finishes`);
    }
  }
});

t('shared broker files and the S24 release match their canonical Devices/sandbox sources', () => {
  // The S24 agent now carries Android liveness and installation evidence. Windows
  // kits remain byte-identical to each other until their next separately pinned
  // release; the protocol/signer/guard files remain common to all three kits.
  for (const installer of INSTALLERS) {
    for (const name of pins(installer).keys()) {
      if (name === 'device_agent.py' && installer.kit !== 'S24') continue;
      assert.equal(
        sha256(join(ROOT, 'Devices', installer.kit, name)),
        sha256(join(CANONICAL, name)),
        `${installer.kit}/${name} differs from Devices/sandbox/${name}`);
    }
  }
  assert.equal(
    sha256(join(ROOT, 'Devices', 'Lenovo', 'device_agent.py')),
    sha256(join(ROOT, 'Devices', 'Vivobook', 'device_agent.py')),
    'the two Windows kits no longer carry the same pinned agent release',
  );
});

t('all three installers agree on every shared artifact they all pin', () => {
  const parsed = INSTALLERS.map((i) => ({ kit: i.kit, pins: pins(i) }));
  for (const name of SHARED_CORE) {
    const values = parsed.map((p) => p.pins.get(name).toLowerCase());
    assert.equal(new Set(values).size, 1,
      `${name} is pinned inconsistently across installers: ` +
      parsed.map((p, i) => `${p.kit}=${values[i].slice(0, 12)}…`).join(' '));
  }
});

t('Windows installers remove the retired direct-Firestore startup only after a signed broker proves live', () => {
  for (const kit of ['Lenovo', 'Vivobook']) {
    const source = readFileSync(join(ROOT, 'Devices', kit, `install_${kit.toLowerCase()}.ps1`), 'utf8');
    assert.match(source, /function Remove-LegacyFleetStartup/, `${kit} does not define legacy startup cleanup`);
    assert.match(source, /EKA-Fleet-Agent\.vbs/, `${kit} does not target the retired startup script`);
    assert.match(source, /CommonStartup/, `${kit} does not clean the all-users Startup folder`);
    assert.match(source, /Stop-Process/, `${kit} does not stop an already-running legacy writer`);
    assert.match(source, /Unregister-ScheduledTask/, `${kit} does not retire a matching legacy scheduled task`);
    assert.match(source, /serviceAccountKey\.json/, `${kit} leaves the legacy service-account key on the laptop`);
    assert.match(source, /Write-Warning/, `${kit} makes legacy cleanup failure fatal after broker proof`);
    assert.ok(
      source.lastIndexOf('Remove-LegacyFleetStartup') > source.indexOf('Persistent broker startup did not prove a signed request'),
      `${kit} removes the legacy agent before the replacement broker is proven live`,
    );
  }
});

t('the S24 WhatsApp installer requires the signed broker and never requires a service-account key', () => {
  const source = readFileSync(join(ROOT, 'Devices', 'S24', 'install_daemon.sh'), 'utf8');
  assert.match(source, /verify_broker_install/, 'S24 daemon installer does not verify broker recovery prerequisites');
  assert.match(source, /install_s24\.sh/, 'S24 daemon installer does not direct recovery through the signed broker installer');
  assert.match(source, /BROKER_CONFIG_PATH/, 'S24 daemon installer does not locate the broker config');
  assert.match(source, /broker_state_file/, 'S24 daemon installer does not derive the broker state path from config');
  assert.match(source, /installation_evidence_file/, 'S24 daemon installer does not derive the evidence path from config');
  assert.match(source, /broker_recovery_required/, 'S24 daemon installer does not give partial enrollment actionable recovery guidance');
  assert.match(source, /exit 78/, 'S24 daemon installer does not fail loudly when broker recovery is incomplete');
  assert.doesNotMatch(source, /serviceAccountKey/, 'S24 daemon installer must not require a service-account key on the phone');
  assert.ok(source.indexOf('verify_broker_install') < source.indexOf('pkg update -y'),
    'S24 daemon installer installs packages before rejecting an incomplete broker recovery');
});

t('the Server/ installer copies are still dead, not silently assumed working', () => {
  // Server/install_{lenovo,vivobook}.ps1 carry the same broken pins, but repairing them
  // would be cosmetic: $Here is their own directory (line 16) and the source path is
  // Join-Path $Here $Artifact.Name (line 67), yet none of the artifacts exist in Server/.
  // Copy-Item throws "Deploy kit is incomplete" before any hash is compared. This asserts
  // that, so nobody "fixes" those hashes and believes the copies work.
  for (const name of ['install_lenovo.ps1', 'install_vivobook.ps1']) {
    if (!existsSync(join(ROOT, 'Server', name))) continue;
    for (const artifact of CORE) {
      assert.equal(existsSync(join(ROOT, 'Server', artifact)), false,
        `Server/${artifact} now exists - re-check whether Server/${name} is still a dead copy`);
    }
  }
});

console.log(`\n${pass}/${total} passed`);
