"""Matched Work completion regression, reusing the continuity transport.

Consumes authenticated Codex usage. Four fresh executions, no retries. This is
a semantic repair check, not a replacement for the frozen V6 efficiency study.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import runpy
import subprocess
import sys
import time


def completion_errors(projection):
    if not isinstance(projection, dict):
        return ['missing Work projection']
    applicable = [r for r in projection.get('requirements', []) if r.get('status') != 'waived']
    errors = []
    if not applicable:
        errors.append('no applicable requirements')
    if any(r.get('status') != 'verified' or not r.get('evidence_refs') for r in applicable):
        errors.append('completed requirements lack verified progress/evidence')
    progress = projection.get('progress', {})
    if progress.get('applicable') != len(applicable) or progress.get('verified') != len(applicable) or progress.get('percent') != 100:
        errors.append('progress counters disagree with completed requirements')
    if projection.get('conflicts'):
        errors.append('unresolved Work conflicts')
    return errors


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


async def main(args):
    from codex_continuity_runtime import Runtime
    from instruction_efficiency import source_lock, versions
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    directory = Path(__file__).resolve().parent
    # Both use the candidate lane, avoiding the legacy baseline privacy override.
    sources = {'v6': args.baseline.resolve(), 'v7': args.candidate.resolve()}
    plan = {
        'created_ns': time.time_ns(),
        'sources': {k: {'path': str(v), 'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=v, text=True).strip()} for k, v in sources.items()},
        'harness': {p.name: sha(p) for p in [Path(__file__), directory / 'instruction_efficiency.py', directory / 'codex_continuity.py', directory / 'codex_continuity_runtime.py', directory / 'codex_continuity_audit.py']},
        'source_locks': {k: source_lock(v) for k, v in sources.items()},
        'versions': versions(),
        'order': [(0, 'v6'), (0, 'v7'), (1, 'v7'), (1, 'v6')],
        'rows': [
            [{'approved': True, 'quantity': 8}, {'approved': False, 'quantity': 99}, {'approved': True, 'quantity': 4}],
            [{'approved': True, 'quantity': 18}, {'approved': False, 'quantity': -200}, {'approved': True, 'quantity': -6}],
        ],
        'contract': 'Every V7 run: exact authorized submission, all applicable Work requirements verified with evidence at resume-turn end, and no Work-ledger changes in read-only question/fresh-session turns. Preserve V6 failures. Model/transport audit and manual semantic review required. No general latency or unseen-holdout claim.',
    }
    (output / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    results = []
    for repetition, arm in plan['order']:
        assert all(sha(directory / name) == value for name, value in plan['harness'].items()), 'harness drift'
        assert versions() == plan['versions'], 'runtime drift'
        assert all(source_lock(v) == plan['source_locks'][k] for k, v in sources.items()), 'source drift'
        folder = output / f'{repetition}-{arm}'
        snapshots = []

        class ObservedRuntime(Runtime):
            async def turn(self, prompt, effort='high'):
                ledger = self.cwd / '.anamnesis/work-units/wu_orders/ledger.jsonl'
                readonly = prompt.startswith('Side question only:') or prompt.startswith('Read TASK.md')
                before = sha(ledger) if readonly and ledger.exists() else None
                result = await super().turn(prompt, effort)
                if readonly:
                    snapshots.append({'kind': 'readonly', 'before': before, 'after': sha(ledger) if ledger.exists() else None})
                if prompt.startswith('I explicitly resume'):
                    status = subprocess.run([str(self.cwd / 'bin/anamnesis'), 'work', 'status', '--work', 'wu_orders', '--json'], cwd=self.cwd, capture_output=True, text=True)
                    snapshots.append({'kind': 'resume', 'code': status.returncode, 'status': json.loads(status.stdout) if status.returncode == 0 else None})
                return result

        sys.argv = ['codex_continuity.py', '--baseline', str(sources['v6']), '--candidate', str(sources[arm]), '--output', str(folder)]
        namespace = runpy.run_path(str(directory / 'codex_continuity.py'))
        namespace['run'].__globals__['Runtime'] = ObservedRuntime
        namespace['CASES']['cancel']['rows'] = plan['rows'][repetition]
        await namespace['run']('cancel', 'candidate')
        assert all(sha(directory / name) == value for name, value in plan['harness'].items()), 'harness drift'
        assert all(source_lock(v) == plan['source_locks'][k] for k, v in sources.items()), 'source drift'
        (folder / 'boundary-snapshots.json').write_text(json.dumps(snapshots, indent=2) + '\n')
        checked = subprocess.run([sys.executable, str(directory / 'codex_continuity_audit.py'), '--output', str(folder)], capture_output=True, text=True)
        (folder / 'legacy-full-audit.json').write_text(json.dumps({'exit_code': checked.returncode, 'expected_missing_cases': True, 'stdout': checked.stdout, 'stderr': checked.stderr}, indent=2))
        audit = json.loads((folder / 'audit.json').read_text())
        assert len(audit) == 1 and audit[0]['label'] == 'cancel-candidate'
        row = audit[0]
        errors = list(row['mechanical_errors'])
        if not row['numeric_submission_pass'] or not row['usage_totals_reconcile'] or row['raw_response_conflicts'] or row['capture_failures']:
            errors.append('numeric/usage/capture gate')
        resumed = [s for s in snapshots if s['kind'] == 'resume']
        errors += completion_errors(resumed[0]['status']['projection'] if len(resumed) == 1 and resumed[0]['status'] else None)
        reads = [s for s in snapshots if s['kind'] == 'readonly']
        if len(reads) != 2 or any(not s['before'] or s['before'] != s['after'] for s in reads):
            errors.append('read-only Work ledger mutation or missing boundary')
        results.append({'repetition': repetition, 'arm': arm, 'errors': errors, 'tokens': row['usage'], 'elapsed_s': row['elapsed_s_including_compaction_and_fresh_thread'], 'commands': row['commands']})
        (output / 'progress.json').write_text(json.dumps(results, indent=2) + '\n')
        print(json.dumps(results[-1]), flush=True)
    passed = len(results) == 4 and all(not r['errors'] for r in results if r['arm'] == 'v7')
    (output / 'result.json').write_text(json.dumps({'pass': passed, 'manual_semantic_review_required': True, 'results': results}, indent=2) + '\n')
    return 0 if passed else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    sys.exit(asyncio.run(main(parser.parse_args())))
