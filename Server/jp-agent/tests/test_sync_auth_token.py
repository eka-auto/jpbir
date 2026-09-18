import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('sync_auth', Path(__file__).parents[1] / 'sync-auth-token.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TokenSyncTests(unittest.TestCase):
    def test_replaces_old_credentials_preserving_other_settings(self):
        value = module.replace_token('JP_AGENT_TOKEN=keep\nANTHROPIC_API_KEY=old\nANTHROPIC_AUTH_TOKEN=stale\n', 'sk-ant-test')
        self.assertEqual(value, 'JP_AGENT_TOKEN=keep\nANTHROPIC_AUTH_TOKEN=sk-ant-test\n')
        self.assertEqual(module.replace_token(value, 'sk-ant-test'), value)

    def test_rejects_environment_injection(self):
        for value in ['', 'sk-ant-test\nOTHER=value', 'sk-ant-test\rOTHER=value', 'bad']:
            with self.assertRaises(ValueError):
                module.replace_token('', value)


if __name__ == '__main__':
    unittest.main()
