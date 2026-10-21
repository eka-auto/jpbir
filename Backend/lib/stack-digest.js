// The digest of a subject: a hash over its file list and their content
// hashes.
//
// It lives in its own module because both ends need it and they cannot
// import each other: the generator (scripts/stack-subjects.mjs) computes it
// while writing the pinned manifest, and the runtime
// (Backend/lib/stack-evidence.js) compares against that manifest. One
// definition, two consumers — a second copy of this rule is how the pinned
// digest and the verified digest would drift into disagreeing about what was
// checked.

import crypto from 'crypto';

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

export function digestOf(files) {
  const canonical = (files || [])
    .map((f) => f.path + ' ' + f.sha256)
    .sort()
    .join('\n');
  return 'sha256:' + sha256(canonical);
}
