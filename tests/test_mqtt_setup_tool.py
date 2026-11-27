# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Standalone MQTT setup helper; no network or physical device."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch, MagicMock
from urllib.parse import parse_qs, urlsplit
from urllib.error import URLError

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'configure_mqtt.py'

class TestMQTTSetup(unittest.TestCase):
    def run_helper(self, inputs=None, password='a&b+? #', result=True, failure=None):
        inputs = inputs or ['192.168.7.1', '192.168.1.20', '', 'req_test', 'TAK']
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value.read.return_value = json.dumps({'ChangeAdditionalBrokerConfigurationResult': result, 'Message': password}).encode()
        if failure:
            opener.open.side_effect = failure
        self.opener = opener
        self.stdout = io.StringIO()
        with patch('builtins.input', side_effect=inputs), patch('getpass.getpass', return_value=password), patch('urllib.request.build_opener', return_value=opener) as build, contextlib.redirect_stdout(self.stdout):
            self.build = build
            runpy.run_path(str(SCRIPT), run_name='__main__')

    def test_single_request_and_encoding(self):
        self.run_helper()
        self.opener.open.assert_called_once()
        url = urlsplit(self.opener.open.call_args.args[0]); query = parse_qs(url.query)
        self.assertEqual(url.netloc, '192.168.7.1')
        self.assertEqual(query['name'], ['ChangeAdditionalBrokerConfiguration'])
        self.assertEqual(query['MQTT_ADDITIONAL_BROKER_PASSWORD'], ['a&b+? #'])
        self.assertEqual(query['MQTT_ADDITIONAL_BROKER_PORT'], ['1883'])
        self.assertEqual(self.build.call_args.args[0].proxies, {})
        self.assertIsNone(self.build.call_args.args[1].redirect_request(None,None,302,None,None,'http://example.invalid'))
        self.assertNotIn('a&b+? #', self.stdout.getvalue())

    def test_cancel_no_request(self):
        with self.assertRaises(SystemExit): self.run_helper(['192.168.7.1','192.168.1.20','','req_test','NIE'])
        self.opener.open.assert_not_called()

    def test_non_private_ip_no_request(self):
        with self.assertRaises(ValueError): self.run_helper(['203.0.113.10'])
        self.opener.open.assert_not_called()

    def test_empty_password_no_request(self):
        with self.assertRaises(SystemExit): self.run_helper(password='')
        self.opener.open.assert_not_called()

    def test_uncertain_result_no_retry(self):
        with self.assertRaises(SystemExit): self.run_helper(result=False)
        self.opener.open.assert_called_once()

    def test_network_failure_no_retry(self):
        with self.assertRaises(SystemExit): self.run_helper(failure=URLError('mock error'))
        self.opener.open.assert_called_once()
