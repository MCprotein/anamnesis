"""Deterministic, local evaluator cases. Never start Codex or read account auth."""
import argparse
import asyncio
import contextlib
import copy
import io
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

import instruction_efficiency as evaluator


class FakeRuntime:
    fail = None

    def __init__(self, home, cwd, log, context=False):
        self.home, self.cwd, self.log = home, cwd, log
        self.events = []
        self.index = 0
        self.total = 0
        self.task = None
        self.fail = type(self).fail
        self.tid = cwd.parent.name
        self.compact_index = 0

    def event(self, method, params):
        event = {'time': time.time(), 'method': method, 'params': {'threadId': self.tid, **params}}
        self.events.append(event)
        with self.log.open('a') as stream:
            stream.write(json.dumps(event) + '\n')
        return event

    async def start(self):
        if self.fail == 'setup':
            raise RuntimeError('fake setup failure')
        self.home.mkdir()
        (self.home / 'config.toml').write_text('fake scoped runtime config')
        (self.home / 'sessions').mkdir()
        self.session = self.home / 'sessions/thread.jsonl'
        self.session.write_text(json.dumps({'type': 'session_meta', 'payload': {'id': self.tid}}) + '\n')

    async def trust(self):
        return {'data': [{'hooks': []}]}

    async def request(self, method, params):
        if method == 'config/read':
            return {'config': {'model': evaluator.MODEL, 'model_reasoning_effort': 'high',
                               'features': {'context_management': False}}}
        if method == 'thread/start':
            self.tid = self.cwd.parent.name
            return {'model': evaluator.MODEL, 'thread': {'id': self.tid}, 'approvalPolicy': 'never',
                    'cwd': str(self.cwd), 'sandbox': {'type': 'workspaceWrite', 'networkAccess': False,
                                'excludeTmpdirEnvVar': True, 'excludeSlashTmp': True,
                                'writableRoots': [str(self.home / 'anamnesis-state')]}}
        if method == 'turn/steer':
            return {'turnId': params['expectedTurnId']}
        raise AssertionError(method)

    async def send(self, payload):
        self.reply = payload

    @staticmethod
    def usage(total):
        return {'totalTokens': total, 'inputTokens': total - total // 10,
                'outputTokens': total // 10, 'cachedInputTokens': total // 2}

    async def turn(self, prompt, effort='high'):
        if self.fail == 'turn':
            raise RuntimeError('fake turn failure')
        started = time.monotonic()
        if self.task is None:
            self.task = next(t for name, t in evaluator.TASKS.items() if ('-' + name + '-') in self.cwd.parent.name)
        turn_id = 'turn-' + str(self.index)
        with self.session.open('a') as stream:
            stream.write(json.dumps({'type': 'turn_context', 'payload': {
                'turn_id': turn_id, 'model': evaluator.MODEL, 'effort': effort}}) + '\n')
        self.event('turn/started', {'turn': {'id': turn_id}})
        if 'steer' in self.task:
            event = self.event('item/tool/call', {'turnId': turn_id, 'tool': 'await_records', 'arguments': {}})
            event['id'] = 42
            # Rewrite so the raw callback request has its real request ID.
            lines = self.log.read_text().splitlines()
            lines[-1] = json.dumps(event)
            self.log.write_text('\n'.join(lines) + '\n')
            await self.callbacks(event)
        await asyncio.sleep(.002)
        self.total += 100
        self.event('thread/tokenUsage/updated', {'turnId': turn_id, 'tokenUsage': {'total': self.usage(self.total)}})
        # Duplicate cumulative updates must never be summed.
        self.event('thread/tokenUsage/updated', {'turnId': turn_id, 'tokenUsage': {'total': self.usage(self.total)}})
        self.event('rawResponse/completed', {'turnId': turn_id, 'responseId': 'response-' + turn_id,
                                              'usage': self.usage(100)})
        self.event('item/completed', {'turnId': turn_id, 'item': {'id': 'comment-' + turn_id,
                   'type': 'agentMessage', 'phase': 'commentary', 'text': 'irrelevant wrong answer'}})
        answer = json.dumps(self.task['expected'][self.index])
        self.event('item/completed', {'turnId': turn_id, 'item': {'id': 'final-' + turn_id,
                   'type': 'agentMessage', 'phase': 'final_answer', 'text': answer}})
        self.event('turn/completed', {'turn': {'id': turn_id, 'status': 'completed'}})
        self.index += 1
        return {'turn_id': turn_id, 'elapsed_s': time.monotonic() - started, 'status': 'completed',
                'answers': ['wrong commentary', answer], 'usage': []}

    async def compact(self):
        self.event('turn/started', {'turn': {'id': 'compact'}})
        await asyncio.sleep(.002)
        self.event('rawResponse/completed', {'turnId': 'compact', 'responseId': 'compact-response',
                                              'usage': self.usage(30)})
        event = self.event('item/completed', {'turnId': 'compact',
                                             'item': {'id': 'compact-item', 'type': 'contextCompaction'}})
        self.event('turn/completed', {'turn': {'id': 'compact', 'status': 'completed'}})
        return event

    async def stop(self):
        if self.fail in ('cleanup', 'setup_cleanup'):
            raise RuntimeError('fake cleanup failure')


def fake_fixture(root, source, task, log):
    root.mkdir(parents=True)
    (root / '.anamnesis').mkdir()
    (root / 'AGENTS.md').write_text('fixed instructions')
    (root / 'system_graph.yaml').write_text('fixed facts')
    if 'file' in task:
        evaluator.write_json(root / task['file'], task['rows'])
    Path(log).write_text('local fake fixture')
    return 'a' * 40


class EvaluatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        (self.source / 'cli/dist').mkdir(parents=True)
        (self.source / 'cli/dist/index.js').write_text('fake source')
        self.protocol = self.root / 'PROTOCOL.md'
        self.protocol.write_text('frozen local fake protocol')
        self.out = self.root / 'formal'
        self.version_patch = patch.object(evaluator, 'versions', return_value={'codex': 'fake', 'node': 'fake', 'git': 'fake'})
        self.git_patch = patch.object(evaluator, 'git_revision', return_value=evaluator.BASELINE_REF)
        self.git_patch.start()
        self.addCleanup(self.git_patch.stop)
        self.version_patch.start()
        self.addCleanup(self.version_patch.stop)
        with patch.object(evaluator, 'fixture', side_effect=fake_fixture), contextlib.redirect_stdout(io.StringIO()):
            evaluator.freeze(argparse.Namespace(output=self.out, baseline=self.source, candidate=self.source,
                                                protocol=self.protocol, batch='test'))
        self.plan = evaluator.read_json(self.out / 'plan.json')
        self.sample = self.plan['runs'][0]
        self.folder = self.out / 'runs' / self.sample['run_id']

    def execute(self, task_id='lookup'):
        self.sample = next(r for r in self.plan['runs'] if r['task_id'] == task_id)
        self.folder = self.out / 'runs' / self.sample['run_id']
        return asyncio.run(evaluator.execute(self.out, self.plan, self.sample, FakeRuntime))

    def evidence(self):
        return evaluator.evidence(self.folder, self.plan, self.sample)

    def mutate_result(self, mutate):
        path = self.folder / 'result.json'
        result = evaluator.read_json(path)
        mutate(result)
        evaluator.write_json(path, result)

    def mutate_events(self, mutate):
        path = self.folder / 'events.jsonl'
        events = [json.loads(line) for line in path.read_text().splitlines()]
        mutate(events)
        path.write_text(''.join(json.dumps(e) + '\n' for e in events))
        self.mutate_result(lambda result: result.update(events_sha256=evaluator.digest(path)))

    def audit(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return evaluator.audit(argparse.Namespace(output=self.out, plan_id=self.plan['plan_id']))

    def test_exact_plan_and_counterbalance(self):
        self.assertEqual(len(self.plan['runs']), 54)
        self.assertEqual([r['arm'] for r in self.plan['runs'][:4]], ['baseline', 'candidate', 'candidate', 'baseline'])
        self.assertEqual(evaluator.load_plan(self.out, self.plan['plan_id']), self.plan)
        with self.assertRaisesRegex(ValueError, 'external'):
            evaluator.load_plan(self.out, 'wrong')

    def test_plan_source_runtime_prompt_and_fixture_drift_fail_closed(self):
        for field, value in [('tasks', {}), ('settings', {}), ('harness', 'wrong'), ('runtime', 'wrong')]:
            with self.subTest(field=field):
                changed = copy.deepcopy(self.plan)
                changed[field] = value
                evaluator.write_json(self.out / 'plan.json', changed)
                with self.assertRaises(ValueError):
                    evaluator.load_plan(self.out, self.plan['plan_id'])
        evaluator.write_json(self.out / 'plan.json', self.plan)
        (self.source / 'cli/dist/index.js').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'source changed'):
            evaluator.load_plan(self.out, self.plan['plan_id'])
        (self.source / 'cli/dist/index.js').write_text('fake source')
        (self.folder / 'frozen-fixture/extra').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'frozen fixture'):
            evaluator.load_plan(self.out, self.plan['plan_id'])

    def test_last_cumulative_total_and_only_final_phase(self):
        self.execute()
        data = self.evidence()
        self.assertEqual(data['tokens']['totalTokens'], 100)
        self.assertEqual(data['tokens']['cachedInputTokens'], 50)

    def test_warm_whole_thread_cumulative_total(self):
        self.execute('warm_question')
        data = self.evidence()
        self.assertEqual(data['tokens']['totalTokens'], 300)
        self.assertEqual([t['kind'] for t in data['turns']], ['startup', 'warm', 'warm'])

    def test_controlled_compaction_is_separately_reported(self):
        self.execute('compaction')
        data = self.evidence()
        self.assertEqual(data['tokens']['totalTokens'], 230)
        self.assertEqual(data['cumulative_tokens']['totalTokens'], 200)
        self.assertEqual(data['controlled_compaction_tokens']['totalTokens'], 30)
        self.assertEqual(data['raw_response_tokens']['totalTokens'], 230)

    def test_compaction_then_side_question_retains_all_normal_turns(self):
        task = copy.deepcopy(evaluator.TASKS['compaction'])
        task['prompts'].insert(1, 'Side question: return only JSON {"answer":7}. Keep the original task pending.')
        task['expected'].insert(1, {'answer': 7})
        self.plan['tasks']['compaction'] = task
        with patch.dict(evaluator.TASKS, {'compaction': task}):
            self.execute('compaction')
            self.assertEqual(self.evidence()['tokens']['totalTokens'], 330)
            events_path = self.folder / 'events.jsonl'
            result_path = self.folder / 'result.json'
            original_events, original_result = events_path.read_text(), result_path.read_text()
            def reorder(events):
                indices = [i for i, event in enumerate(events) if event.get('method') == 'turn/completed']
                events[indices[1]], events[indices[2]] = events[indices[2]], events[indices[1]]
            self.mutate_events(reorder)
            with self.assertRaisesRegex(ValueError, 'compaction ordering'):
                self.evidence()
            events_path.write_text(original_events)
            result_path.write_text(original_result)
            def duplicate(events):
                events.append(next(event for event in events if event.get('method') == 'item/completed' and event['params']['item']['type'] == 'contextCompaction'))
            self.mutate_events(duplicate)
            with self.assertRaisesRegex(ValueError, 'compaction'):
                self.evidence()

    def test_original_execution_artifact_is_audit_only_and_stays_pinned(self):
        original = self.root / 'original-execution.py'
        original.write_text('previous frozen execution artifact')
        self.plan['harness'] = evaluator.digest(original)
        self.plan['plan_id'] = evaluator.identity({k: v for k, v in self.plan.items() if k != 'plan_id'})
        evaluator.write_json(self.out / 'plan.json', self.plan)
        with self.assertRaisesRegex(ValueError, 'harness changed'):
            evaluator.load_plan(self.out, self.plan['plan_id'])
        self.assertEqual(evaluator.load_plan(self.out, self.plan['plan_id'], execution_harness=original), self.plan)
        args = argparse.Namespace(output=self.out, plan_id=self.plan['plan_id'], run_id=self.sample['run_id'], execution_harness=original)
        with self.assertRaisesRegex(ValueError, 'harness changed'):
            asyncio.run(evaluator.run(args))
        historical = self.out / 'audit.json'
        historical.write_text('original failed grading')
        with contextlib.redirect_stdout(io.StringIO()):
            evaluator.audit(args)
            corrected = (self.out / 'audit.corrected.json').read_bytes()
            with self.assertRaises(FileExistsError):
                evaluator.audit(args)
        self.assertEqual(historical.read_text(), 'original failed grading')
        self.assertEqual((self.out / 'audit.corrected.json').read_bytes(), corrected)
        original.write_text('tampered')
        with self.assertRaisesRegex(ValueError, 'harness changed'):
            evaluator.load_plan(self.out, self.plan['plan_id'], execution_harness=original)

    def test_delayed_result_steering(self):
        self.execute('delayed')
        self.assertEqual(self.evidence()['tokens']['totalTokens'], 100)
        self.mutate_result(lambda r: r['steering'][0].update(released_ns=r['steering'][0]['sent_ns']))
        with self.assertRaisesRegex(ValueError, 'steering'):
            self.evidence()

    def test_manual_discovery_must_be_absent(self):
        self.execute('manual_fallback')
        self.evidence()
        self.mutate_result(lambda r: r.update(hooks={'data': [{'hooks': [{'name': 'native'}]}]}))
        with self.assertRaisesRegex(ValueError, 'native hooks'):
            self.evidence()

    def test_external_state_mutation_rejected(self):
        self.execute()
        state = self.folder / 'home/anamnesis-state'
        state.mkdir()
        (state / 'unauthorized').write_text('changed')
        self.mutate_result(lambda r: r.update(state_after=evaluator.state_snapshot(state)))
        with self.assertRaisesRegex(ValueError, 'external state mutation'):
            self.evidence()

    def test_package_code_stays_locked_but_test_results_do_not(self):
        cache = self.source / 'node_modules/.vite/vitest/sample/results.json'
        cache.parent.mkdir(parents=True)
        cache.write_text('first')
        evaluator.load_plan(self.out, self.plan['plan_id'])
        cache.write_text('second')
        evaluator.load_plan(self.out, self.plan['plan_id'])
        code = self.source / 'node_modules/yaml/index.js'
        code.parent.mkdir(parents=True)
        code.write_text('changed executable dependency')
        with self.assertRaisesRegex(ValueError, 'source changed'):
            evaluator.load_plan(self.out, self.plan['plan_id'])

    def test_fresh_holdout_contract_and_protected_paths(self):
        path = self.out / 'fresh.json'
        tasks = {f'fresh_case_{i}': {'suite': 'reserved', 'prompts': ['Return JSON.'],
                                  'expected': [{'ok': True}]} for i in range(8)}
        try:
            evaluator.write_json(path, tasks)
            lock = evaluator.select_tasks(path)
            self.assertEqual(len(evaluator.TASKS), 11)
            self.assertEqual(lock['sha256'], evaluator.digest(path))
            self.assertNotIn('lookup_signed', evaluator.TASKS)
            for bad in ['../escape', '.git/config', '.codex/hooks.json', 'AGENTS.md',
                        '.anamnesis/manifest.json', 'nested/.codex/hooks.json', 'nested/.anamnesis/work/state.json', '/tmp/escape', '.']:
                with self.subTest(path=bad):
                    tasks['fresh_case_0']['fixture_files'] = {bad: 'bad'}
                    evaluator.write_json(path, tasks)
                    with self.assertRaises(ValueError):
                        evaluator.select_tasks(path)
        finally:
            evaluator.select_tasks()

    def test_declared_edit_preserves_other_files_and_modes(self):
        root = self.folder / 'fixture'
        path = root / 'settings.json'
        path.write_text('{"count": 1, "protected": true}')
        before = evaluator.manifest(root)
        task = {'expected': [{'ok': True}], 'expected_files': {
            'settings.json': {'format': 'json', 'value': {'count': 2, 'protected': True}}}}
        answer = ['{"ok": true}']
        path.write_text('{"protected": true, "count": 2}')
        self.assertTrue(evaluator.score(task, root, answer, before, 'a' * 40)['pass'])
        path.write_text('{"protected": false, "count": 2}')
        self.assertFalse(evaluator.score(task, root, answer, before, 'a' * 40)['pass'])
        path.write_text('{"protected": true, "count": 2}')
        path.chmod(0o700)
        self.assertFalse(evaluator.score(task, root, answer, before, 'a' * 40)['pass'])
        path.chmod(before['settings.json']['mode'])
        (root / 'unrequested.txt').write_text('bad')
        self.assertFalse(evaluator.score(task, root, answer, before, 'a' * 40)['pass'])

    def test_all_fixture_mutations_rejected(self):
        before = self.sample['fixture']
        root = self.folder / 'fixture'
        for name in ['new.txt', '.codex/hidden', '.git/config']:
            with self.subTest(name=name):
                path = root / name
                path.parent.mkdir(exist_ok=True)
                path.write_text('unauthorized')
                self.assertFalse(evaluator.score(evaluator.TASKS['lookup'], root, ['{"total":12}'], before, 'a' * 40)['pass'])
                path.unlink()
                if path.parent != root:
                    path.parent.rmdir()
        (root / 'AGENTS.md').chmod(0o700)
        self.assertFalse(evaluator.score(evaluator.TASKS['lookup'], root, ['{"total":12}'], before, 'a' * 40)['pass'])

    def test_strict_semantic_answers(self):
        root = self.folder / 'fixture'
        task = evaluator.TASKS['orientation']
        before = evaluator.manifest(root)
        for answer in ['7319 inventory modify', '{"service":"dispatch","port":7319,"dependency":"inventory","lookup_source_mutation_allowed":true}',
                       json.dumps({**task['expected'][0], 'extra': 1})]:
            self.assertFalse(evaluator.score(task, root, [answer], before, 'a' * 40)['pass'])
        self.assertTrue(evaluator.score(task, root, [json.dumps(task['expected'][0])], before, 'a' * 40)['pass'])

    def test_handoff_complete_contract_and_unstarted_status(self):
        root = self.folder / 'fixture'
        before = evaluator.manifest(root)
        directory = root / '.anamnesis/handoff'
        directory.mkdir()
        archive = directory / '2000-01-01T00-00-00Z.md'
        archive.write_text('---\ncreated: 2000-01-01T00:00:00Z\nagent: codex\ngit_ref: ' + 'a' * 40 + '\n---\n'
                           '# Handoff — dispatch migration\n## Goal\nReview migration.\n## Done so far\n'
                           '7319 inventory confirmed in system_graph.yaml.\n## In flight\nImplementation has not started.\n'
                           '## Decisions\nPreserve current port.\n## Open questions / blockers\nNone.\n## Next steps\n1. Review migration.\n')
        active = directory / 'active.md'
        active.write_text('---\nupdated: 2000-01-01T00:00:00Z\nagent: codex\ngit_ref: ' + 'a' * 40 + '\n---\n'
                          '# Active handoff index\n## Current focus\nReview dispatch migration — archive: `.anamnesis/handoff/' + archive.name + '`\n'
                          '## Active tasks\n- [in-flight] Review migration\n## Recently completed\nNone.\n')
        check = lambda: evaluator.score(evaluator.TASKS['handoff'], root, [], before, 'a' * 40)['pass']
        self.assertTrue(check())
        original = archive.read_text()
        for wrong in [original.replace('a' * 40, 'b' * 40), original.replace('Implementation has not started', 'Implementation is complete'),
                      original.replace('## Decisions', '## Other')]:
            archive.write_text(wrong)
            self.assertFalse(check())
        archive.write_text(original)
        active.write_text(active.read_text().replace(archive.name, 'wrong.md'))
        self.assertFalse(check())

    def test_recorded_failures_persist_including_cleanup(self):
        for phase in ['setup', 'turn', 'cleanup']:
            with self.subTest(phase=phase):
                sample = self.plan['runs'][['setup', 'turn', 'cleanup'].index(phase)]
                with patch.object(FakeRuntime, 'fail', phase):
                    result = asyncio.run(evaluator.execute(self.out, self.plan, sample, FakeRuntime))
                self.assertEqual(result['status'], 'failed')
                self.assertIn(phase, result['errors'])
                self.assertEqual(evaluator.read_json(self.out / 'runs' / sample['run_id'] / 'result.json'), result)

    def test_fixture_preflight_failure_persists(self):
        (self.folder / 'fixture/extra').touch()
        result = self.execute()
        self.assertIn('setup', result['errors'])

    def test_invalid_usage_and_model_evidence(self):
        self.execute()
        original = (self.folder / 'result.json').read_text()
        for mutate in [lambda r: r.update(elapsed_s=0), lambda r: r['thread_start'].update(model='wrong'),
                       lambda r: r['config']['config'].update(model_reasoning_effort='low'),
                       lambda r: r['config']['config']['features'].update(context_management=True),
                       lambda r: r['thread_start']['sandbox'].update(networkAccess=True),
                       lambda r: r.update(session_files={}), lambda r: r['turns'][0].update(prompt='changed')]:
            with self.subTest(mutation=mutate):
                self.mutate_result(mutate)
                with self.assertRaises(ValueError):
                    self.evidence()
                (self.folder / 'result.json').write_text(original)
        self.mutate_events(lambda es: es.append({'method': 'thread/tokenUsage/updated', 'params': {
            'threadId': self.sample['run_id'], 'turnId': 'turn-0', 'tokenUsage': {'total': FakeRuntime.usage(-10)}}}))
        with self.assertRaisesRegex(ValueError, 'token values'):
            self.evidence()

    def test_missing_raw_usage_final_answer_and_extra_thread(self):
        self.execute()
        events = (self.folder / 'events.jsonl').read_text()
        record = (self.folder / 'result.json').read_text()
        for mutation in [lambda es: es.__setitem__(slice(None), [e for e in es if e['method'] != 'rawResponse/completed']),
                         lambda es: es.__setitem__(slice(None), [e for e in es if e.get('params', {}).get('item', {}).get('phase') != 'final_answer']),
                         lambda es: es.append({'method': 'thread/tokenUsage/updated', 'params': {'threadId': 'child'}})]:
            self.mutate_events(mutation)
            with self.assertRaises(ValueError):
                self.evidence()
            (self.folder / 'events.jsonl').write_text(events)
            (self.folder / 'result.json').write_text(record)

    def test_missing_extra_and_duplicate_samples_rejected(self):
        self.assertEqual(self.audit(), 1)
        (self.out / 'runs/extra').mkdir()
        self.assertEqual(self.audit(), 1)
        (self.out / 'runs/extra').rmdir()
        self.execute()
        (self.folder / 'duplicate').mkdir()
        (self.folder / 'duplicate/result.json').write_text((self.folder / 'result.json').read_text())
        self.assertEqual(self.audit(), 1)
        self.assertFalse(evaluator.read_json(self.out / 'audit.json')['pass'])

    def test_retry_and_out_of_order_run_rejected(self):
        args = argparse.Namespace(output=self.out, plan_id=self.plan['plan_id'], run_id=self.plan['runs'][1]['run_id'])
        with self.assertRaisesRegex(ValueError, 'order'):
            asyncio.run(evaluator.run(args))
        self.execute()
        args.run_id = self.sample['run_id']
        with self.assertRaisesRegex(ValueError, 'retry'):
            asyncio.run(evaluator.run(args))

    def test_both_suites_enforce_exact_thresholds(self):
        samples = {r['run_id']: {'tokens': {'totalTokens': 100 if r['arm'] == 'baseline' else 90},
                                  'elapsed_s': 100 if r['arm'] == 'baseline' else 105} for r in self.plan['runs']}
        self.assertTrue(evaluator.aggregate(self.plan, samples)['pass'])
        for r in self.plan['runs']:
            if r['arm'] == 'candidate' and r['suite'] == 'reserved':
                samples[r['run_id']]['tokens']['totalTokens'] = 91
        self.assertFalse(evaluator.aggregate(self.plan, samples)['pass'])
        for r in self.plan['runs']:
            if r['arm'] == 'candidate':
                samples[r['run_id']] = {'tokens': {'totalTokens': 90}, 'elapsed_s': 106}
        self.assertFalse(evaluator.aggregate(self.plan, samples)['pass'])

    def test_reserved_scope_preserves_order_and_never_claims_complete_proof(self):
        runs = evaluator.selected_schedule('reserve', 'reserved')
        self.assertEqual(len(runs), 36)
        self.assertEqual([r['order'] for r in runs], list(range(36)))
        self.assertTrue(all(r['suite'] == 'reserved' for r in runs))
        plan = {**self.plan, 'selected_suite': 'reserved', 'runs': runs}
        samples = {r['run_id']: {'tokens': {'totalTokens': 100 if r['arm'] == 'baseline' else 80},
                                  'elapsed_s': 100} for r in runs}
        result = evaluator.aggregate(plan, samples)
        self.assertTrue(result['pass'])
        self.assertFalse(result['complete_efficiency_proof'])
        self.assertEqual(set(result['suites']), {'reserved'})
        with self.assertRaisesRegex(ValueError, 'invalid suite'):
            evaluator.selected_schedule('reserve', 'invented')

    def test_duplicate_json_keys_rejected(self):
        path = self.root / 'duplicate.json'
        path.write_text('{"x":1,"x":2}')
        with self.assertRaisesRegex(ValueError, 'duplicate JSON'):
            evaluator.read_json(path)

    def test_freeze_setup_failure_preserved(self):
        failed = self.root / 'failed-freeze'
        with patch.object(evaluator, 'fixture', side_effect=RuntimeError('fake init failure')):
            with self.assertRaises(RuntimeError):
                evaluator.freeze(argparse.Namespace(output=failed, baseline=self.source, candidate=self.source,
                                                    protocol=self.protocol, batch='failure'))
        result = evaluator.read_json(failed / 'freeze-result.json')
        self.assertEqual(result['status'], 'failed')
        self.assertIn('lookup', result['sample'])
        self.assertTrue(result['errors'])

    def test_fixture_commit_is_deterministic_and_resolvable(self):
        real_run = subprocess.run
        def local_init(command, **kwargs):
            if command[0] == 'node' and '--input-type=module' in command:
                return subprocess.CompletedProcess(command, 0, '', '')
            if command[0] == 'node':
                (kwargs['cwd'] / 'AGENTS.md').write_text('fixed fake generated instructions')
                return subprocess.CompletedProcess(command, 0, stdout='', stderr='')
            return real_run(command, **kwargs)
        with patch.object(evaluator.subprocess, 'run', side_effect=local_init):
            refs = [evaluator.fixture(self.root / name / 'fixture', self.source,
                                      evaluator.TASKS['lookup'], self.root / (name + '.log')) for name in ['one', 'two']]
        self.assertEqual(refs[0], refs[1])
        self.assertRegex(refs[0], r'^[0-9a-f]{40}$')


if __name__ == '__main__':
    unittest.main()
