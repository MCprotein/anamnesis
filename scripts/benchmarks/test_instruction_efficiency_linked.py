import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

import instruction_efficiency as e
import instruction_efficiency_linked as linked


class LinkedAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.path = root / 'link.json'
        protocol = root / 'protocol.md'
        protocol.write_text('frozen')
        self.link = {'linker_sha256': linked.digest(linked.__file__), 'protocol': str(protocol),
                     'protocol_sha256': linked.digest(protocol), 'frozen_ns': 1000}
        self.plans = {}
        for suite in ('development', 'reserved'):
            out = root / suite
            tasks = ['lookup', 'orientation', 'handoff'] if suite == 'development' else ['fresh_' + str(i) for i in range(8)]
            runs = []
            for task in tasks:
                for rep in range(3):
                    for arm in ('baseline', 'candidate'):
                        pair = f'{suite}-{task}-{rep}'
                        run_id = pair + '-' + arm
                        folder = out / 'runs' / run_id
                        folder.mkdir(parents=True)
                        (folder / 'result.json').write_text('{}')
                        runs.append({'run_id': run_id, 'pair_id': pair, 'suite': suite, 'task_id': task,
                                     'arm': arm, 'order': len(runs)})
            if suite == 'development':
                # Historical development plan retains unexecuted reserved fixtures.
                unused = 'historical-unused-reserved'
                (out / 'runs' / unused).mkdir(parents=True)
                runs.append({'run_id': unused, 'suite': 'reserved'})
            self.plans[suite] = {'runs': runs, 'sources': {'frozen': 'same'}, 'versions': {'codex': 'same'},
                                 'settings': {'model': 'same'}, 'selected_suite': suite, 'holdout': {'frozen': True}}
            self.link[suite] = {'output': str(out), 'plan_id': suite}
        self.save()

    def save(self):
        self.link.pop('plan_id', None)
        self.link['plan_id'] = linked.identity(self.link)
        self.path.write_text(json.dumps(self.link))

    def evaluate(self):
        def module(entry, name):
            suite = name.removeprefix('efficiency_')
            def evidence(folder, plan, sample):
                start = (1 if suite == 'development' else 2000) + sample['order'] * 2
                return {'started_ns': start, 'ended_ns': start + 1, 'thread_id': sample['run_id'],
                        'tokens': {'totalTokens': 100 if sample['arm'] == 'baseline' else 80}, 'elapsed_s': 1}
            return types.SimpleNamespace(load_plan=lambda *args: self.plans[suite], evidence=evidence, aggregate=e.aggregate)
        with patch.object(linked, 'load_evaluator', side_effect=module):
            return linked.audit(self.path, self.link['plan_id'])

    def test_reuses_all_development_and_requires_all_fresh_evidence(self):
        result = self.evaluate()
        self.assertTrue(result['pass'], result)
        self.assertEqual(len(result['samples']), 66)
        self.assertTrue(result['complete_efficiency_proof'])
        first = next((Path(self.link['reserved']['output']) / 'runs').glob('*/result.json'))
        first.unlink()
        self.assertFalse(self.evaluate()['pass'])

    def test_nested_duplicates_and_unexpected_unfinished_directories_fail(self):
        out = Path(self.link['reserved']['output'])
        nested = out / 'runs' / self.plans['reserved']['runs'][0]['run_id'] / 'retry'
        nested.mkdir()
        duplicate = nested / 'result.json'
        duplicate.write_text('{}')
        self.assertFalse(self.evaluate()['pass'])
        duplicate.unlink()
        nested.rmdir()
        (out / 'runs' / 'unexpected-unfinished').mkdir()
        self.assertFalse(self.evaluate()['pass'])

    def test_source_and_chronology_mismatches_cannot_pass(self):
        self.plans['reserved']['sources'] = {'frozen': 'different'}
        self.assertFalse(self.evaluate()['pass'])
        self.plans['reserved']['sources'] = {'frozen': 'same'}
        self.link['frozen_ns'] = 1
        self.save()
        self.assertFalse(self.evaluate()['pass'])


if __name__ == '__main__':
    unittest.main()
