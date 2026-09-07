#!/usr/bin/env python3
"""Audit pinned development evidence plus fresh reserved-only measurements.

No model calls and no substitution/retry: every original development sample and
fresh reserved sample must validate against its own frozen evaluator and plan.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def identity(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load_evaluator(entry, name):
    path = Path(entry['evaluator']).resolve()
    require(digest(path) == entry['evaluator_sha256'], 'changed evaluator')
    require(digest(path.with_name('codex_continuity_runtime.py')) == entry['runtime_sha256'], 'changed runtime')
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def audit(link_path, expected_id):
    report = {'pass': False, 'errors': [], 'samples': {}}
    try:
        link = json.loads(Path(link_path).read_text())
        require(link.get('plan_id') == expected_id, 'external linked identity mismatch')
        require(identity({k: v for k, v in link.items() if k != 'plan_id'}) == expected_id, 'changed linked plan')
        require(link['linker_sha256'] == digest(__file__), 'changed linked auditor')
        require(digest(link['protocol']) == link['protocol_sha256'], 'changed linked protocol')
        original_ref = link.get('original_measurement_link')
        require(original_ref or not any('execution_evaluator' in link[suite] for suite in ('development', 'reserved')), 'corrected validation requires original measurement link')
        if original_ref:
            require(digest(original_ref['path']) == original_ref['sha256'], 'changed original measurement link')
            original = json.loads(Path(original_ref['path']).read_text())
            require(original['plan_id'] == original_ref['plan_id'] and identity({k: v for k, v in original.items() if k != 'plan_id'}) == original_ref['plan_id'], 'invalid original measurement identity')
            require(link['frozen_ns'] == original['frozen_ns'] and link['protocol'] == original['protocol'] and link['protocol_sha256'] == original['protocol_sha256'], 'changed measurement freeze or protocol')
            require(digest(link['validator_amendment']['path']) == link['validator_amendment']['sha256'], 'changed validator amendment')
            for suite in ('development', 'reserved'):
                require(all(link[suite][key] == original[suite][key] for key in ('output', 'plan_id')), 'substituted measurement plan')
                if 'execution_evaluator' in link[suite]:
                    require(digest(link[suite]['execution_evaluator']) == original[suite]['evaluator_sha256'], 'changed execution evaluator artifact')
                else:
                    require(link[suite] == original[suite], 'changed uncorrected evaluator')
        sources = versions = settings = None
        combined = []
        threads = set()
        previous = 0
        for suite in ('development', 'reserved'):
            entry = link[suite]
            evaluator = load_evaluator(entry, 'efficiency_' + suite)
            out = Path(entry['output']).resolve()
            plan = evaluator.load_plan(out, entry['plan_id'], execution_harness=entry['execution_evaluator']) if entry.get('execution_evaluator') else evaluator.load_plan(out, entry['plan_id'])
            require(not list(out.glob('rejected-*.json')), 'rejected attempts in ' + suite)
            selected = [s for s in plan['runs'] if s['suite'] == suite]
            require(len(selected) == (18 if suite == 'development' else 48), 'unexpected suite size')
            require({p.name for p in (out / 'runs').iterdir()} == {s['run_id'] for s in plan['runs']}, 'missing/extra run directories in ' + suite)
            results = list(out.rglob('result.json'))
            expected_results = {out / 'runs' / s['run_id'] / 'result.json' for s in selected}
            require(set(results) == expected_results and len(results) == len(expected_results), 'missing/extra/duplicate results in ' + suite)
            if suite == 'reserved':
                require(plan.get('selected_suite') == 'reserved' and plan.get('holdout'), 'fresh reserved-only plan required')
                require(plan['sources'] == sources and plan['versions'] == versions and plan['settings'] == settings, 'unmatched source/runtime/settings')
            else:
                require({s['task_id'] for s in selected} == {'lookup', 'orientation', 'handoff'}, 'changed development tasks')
                sources, versions, settings = plan['sources'], plan['versions'], plan['settings']
            for sample in selected:
                data = evaluator.evidence(out / 'runs' / sample['run_id'], plan, sample)
                require(data['started_ns'] >= previous, 'overlapping/reordered samples')
                require(data['thread_id'] not in threads, 'reused model thread')
                require((data['ended_ns'] < link['frozen_ns']) if suite == 'development' else (data['started_ns'] > link['frozen_ns']), 'invalid selection/freeze chronology')
                threads.add(data['thread_id'])
                previous = data['ended_ns']
                report['samples'][sample['run_id']] = data
                combined.append(sample)
        if original_ref:
            require(link['correction_created_ns'] > previous, 'validator correction must disclose post-measurement creation')
            report['original_measurement_plan_id'] = original_ref['plan_id']
            report['validator_corrected_after_measurement'] = True
        report.update(evaluator.aggregate({'runs': combined}, report['samples']))
        report['plan_id'] = expected_id
        report['development_reused_without_reexecution'] = True
    except Exception as error:
        report['errors'].append(str(error))
        report['pass'] = False
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--link', type=Path, required=True)
    parser.add_argument('--plan-id', required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.link, args.plan_id)
    args.report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'samples'}, indent=2))
    return 0 if result['pass'] else 1


if __name__ == '__main__':
    sys.exit(main())
