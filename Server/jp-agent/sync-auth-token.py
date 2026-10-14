#!/usr/bin/env python3
"""Root-only stdin receiver; never log credentials or accept them in argv."""
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


def replace_token(content, token):
    if not re.fullmatch(r'sk-ant-[A-Za-z0-9_-]+', token):
        raise ValueError('Invalid token format')
    lines = [line for line in content.splitlines()
             if not line.startswith(('ANTHROPIC_API_KEY=', 'ANTHROPIC_AUTH_TOKEN='))]
    return '\n'.join(lines + ['ANTHROPIC_AUTH_TOKEN=' + token]) + '\n'


def main():
    path = Path('/etc/jp-agent.env')
    if os.geteuid() != 0 or not path.is_file():
        raise RuntimeError('Existing root-managed agent configuration required')
    token = sys.stdin.read(16385).strip()
    if len(token) > 16384:
        raise ValueError('Input too large')
    original = path.read_text()
    updated = replace_token(original, token)
    if updated != original:
        fd, temporary = tempfile.mkstemp(prefix='.jp-agent-env-', dir=path.parent)
        try:
            with os.fdopen(fd, 'w') as stream:
                stream.write(updated)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        # Restart every unit that reads ANTHROPIC_AUTH_TOKEN from this file.
        # jp-agent is mandatory and checked: without its restart the new token
        # never takes effect. s24-mcp shares the same env file and would
        # otherwise keep authenticating with the rotated-away credential — but
        # its unit only exists on a box that a deploy.sh which installs it has
        # already touched, so a not-yet-redeployed box must still be able to
        # rotate its token. Hence the tolerant second restart.
        subprocess.run(['systemctl', 'restart', 'jp-agent'], check=True, capture_output=True)
        mcp = subprocess.run(['systemctl', 'restart', 's24-mcp'], capture_output=True)
        if mcp.returncode != 0:
            print('note: s24-mcp was not restarted (unit absent or failed); '
                  'run ./deploy.sh to install it', file=sys.stderr)
    subprocess.run(['systemctl', 'is-active', '--quiet', 'jp-agent'], check=True, capture_output=True)
    print('Cloud token synchronized; service active')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Cloud token synchronization failed; inspect configuration without printing secrets', file=sys.stderr)
        sys.exit(1)
