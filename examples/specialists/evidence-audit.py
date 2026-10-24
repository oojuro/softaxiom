# SPDX-FileCopyrightText: 2026 Soft Axiom contributors
# SPDX-License-Identifier: Apache-2.0
"""Independent offline JSONL specialist. No Soft Axiom/OpenClaw imports or model provider."""
import hashlib
import json
import sys

task = json.loads(sys.argv[1])
assert task['version'] == 1 and task['agent'] == 'external-jsonl'
assert task['permissions']['actions'] == ['analyze']
assert task['permissions']['network'] is False
operation = task['operationId']
print(json.dumps({'version': 1, 'operationId': operation, 'type': 'progress',
                  'text': 'Checking the explicitly supplied evidence only.'}), flush=True)
text = task['input']
findings = []
if 'http://' not in text and 'https://' not in text and 'journal:' not in text:
    findings.append('No source reference was supplied; claims remain unverified.')
if any(word in text.lower() for word in ['ready', 'passed', 'complete', 'fixed']):
    findings.append('Acceptance claims need an exact revision and a recorded check result.')
report = '\n'.join(findings) or 'Source references are present; their contents were not fetched.'
print(json.dumps({'version': 1, 'operationId': operation, 'type': 'result',
                  'text': report, 'artifacts': [{'name': 'evidence-report',
                  'digest': hashlib.sha256(report.encode()).hexdigest()}]}))
