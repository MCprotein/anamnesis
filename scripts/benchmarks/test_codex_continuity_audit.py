"""Local auditor fault injection against synthetic fixtures; no model calls."""
import copy
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


CASES = {'sum-baseline': 9, 'sum-candidate': 9, 'sum-off': 9,
         'maximum-off': -3, 'maximum-candidate': -3, 'maximum-baseline': -3,
         'cancel-candidate': 12, 'cancel-off': 12}


def fixture(root, label, expected):
    case, arm = label.split('-')
    phases = ['first', 'question', 'fresh_session'] + (['resume'] if case == 'cancel' else [])
    result = {'case': case, 'arm': arm, 'expected': expected, 'steer': {'turnId': 'first'},
              'threads': [{'id': name, 'model': 'gpt-6-astra'} for name in ['a', 'b']]}
    events = []
    def event(method, params):
        entry = {'time': len(events), 'method': method, 'params': params}
        events.append(entry)
        return entry
    counts = {'a': 0, 'b': 0}
    for phase in phases:
        result[phase] = {'turn_id': phase, 'status': 'completed'}
        thread = 'b' if phase == 'fresh_session' else 'a'
        counts[thread] += 1
        event('turn/completed', {'turn': {'id': phase, 'status': 'completed'}})
        event('rawResponse/completed', {'responseId': phase, 'turnId': phase, 'usage': {'totalTokens': 12, 'inputTokens': 10, 'cachedInputTokens': 2, 'outputTokens': 2}})
    result['compact'] = event('item/completed', {'turnId': 'compact', 'item': {'type': 'contextCompaction'}})
    event('turn/completed', {'turn': {'id': 'compact', 'status': 'completed'}})
    event('rawResponse/completed', {'responseId': 'compact', 'turnId': 'compact', 'usage': {'totalTokens': 12, 'inputTokens': 10, 'cachedInputTokens': 2, 'outputTokens': 2}})
    for thread, count in counts.items():
        event('thread/tokenUsage/updated', {'threadId': thread, 'tokenUsage': {'total': {k: v * count for k, v in {'totalTokens': 12, 'inputTokens': 10, 'cachedInputTokens': 2, 'outputTokens': 2}.items()}}})
    event('item/tool/call', {'turnId': 'first', 'tool': 'await_records', 'arguments': {}})
    phase = 'resume' if case == 'cancel' else 'first'
    result['submissions'] = [{'phase': phase, 'arguments': {'result': expected}}]
    event('item/tool/call', {'turnId': phase, 'tool': 'submit_result', 'arguments': {'result': expected}})
    sessions = root / f'final-home-{label}' / 'sessions'
    sessions.mkdir(parents=True)
    for thread in ['a', 'b']:
        records = [{'type': 'session_meta', 'payload': {'id': thread}}]
        records += [{'type': 'turn_context', 'payload': {'turn_id': phase, 'model': 'gpt-6-astra', 'effort': 'high'}} for phase in phases if ('b' if phase == 'fresh_session' else 'a') == thread]
        (sessions / f'{thread}.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in records))
    (root / f'final-{label}-result.json').write_text(json.dumps(result))
    (root / f'final-{label}-events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events))


class AuditTests(unittest.TestCase):
    def test_complete_and_missing_or_failed_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for label, expected in CASES.items():
                fixture(root, label, expected)
            command = [sys.executable, str(pathlib.Path(__file__).with_name('codex_continuity_audit.py')), '--output', str(root)]
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            path = root / 'final-sum-candidate-result.json'
            original = json.loads(path.read_text())
            for key, value in [('question', {'turn_id': 'question', 'status': 'failed'}), ('compact', None), ('cleanup_error', 'timeout'), ('source_error', 'drift')]:
                modified = copy.deepcopy(original)
                modified[key] = value
                path.write_text(json.dumps(modified))
                self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0, key)
            path.write_text(json.dumps(original))
            events_path = root / 'final-sum-candidate-events.jsonl'
            events = [json.loads(line) for line in events_path.read_text().splitlines()]
            invalid_counters = [
                {'totalTokens': 1, 'inputTokens': 10, 'outputTokens': -9, 'cachedInputTokens': 0},
                {'totalTokens': 12.5, 'inputTokens': 10, 'outputTokens': 2.5, 'cachedInputTokens': 0},
                {'totalTokens': 12, 'inputTokens': 10, 'outputTokens': 2, 'cachedInputTokens': True},
                {'totalTokens': 12, 'inputTokens': 10, 'outputTokens': 2, 'cachedInputTokens': 11},
                {'totalTokens': 12, 'inputTokens': 10, 'outputTokens': 2, 'cachedInputTokens': 0, 'reasoningOutputTokens': 3},
                {'totalTokens': 12, 'inputTokens': 10, 'outputTokens': 2, 'cachedInputTokens': 0, 'reasoningOutputTokens': -1},
                {'totalTokens': 12, 'inputTokens': 10, 'outputTokens': 2},
                {'totalTokens': '12', 'inputTokens': 10, 'outputTokens': 2, 'cachedInputTokens': 0},
            ]
            for counters in invalid_counters:
                for target in ['compact', 'first', 'thread']:
                    modified = copy.deepcopy(events)
                    for entry in modified:
                        if target == 'thread' and entry['method'] == 'thread/tokenUsage/updated':
                            entry['params']['tokenUsage']['total'] = counters
                        elif entry['method'] == 'rawResponse/completed' and entry['params']['turnId'] == target:
                            entry['params']['usage'] = counters
                    events_path.write_text(''.join(json.dumps(e) + '\n' for e in modified))
                    run = subprocess.run(command, capture_output=True)
                    self.assertNotEqual(run.returncode, 0, (target, counters))
                    self.assertIn(b'invalid usage counters', run.stderr)
            events_path.write_text(''.join(json.dumps(e) + '\n' for e in events if not (e['method'] == 'rawResponse/completed' and e['params']['turnId'] == 'compact')))
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            events_path.write_text(''.join(json.dumps(e) + '\n' for e in events if e['method'] not in ['rawResponse/completed', 'thread/tokenUsage/updated']))
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()
