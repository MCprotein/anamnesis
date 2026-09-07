#!/usr/bin/env python3
"""Frozen account-run evaluator. freeze is local; run alone starts measured models.

A plan is immutable: failed attempts are retained and cannot be retried in place.
A second batch must be frozen before inspecting first-batch outcomes. Pilot data
outside the formal plan directory is retained and never admitted to scoring.
"""
import argparse
import asyncio
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import shutil
import statistics
import subprocess
import sys
import time

from codex_continuity_runtime import Runtime

BASELINE_REF = '07f2531e4b4bba589d062b1ef84757bf5cc74234'
MODEL = 'gpt-6-astra'
SETTINGS = {'model': MODEL, 'effort': 'high', 'context_management': False,
            'sandbox': 'workspace-write', 'approvalPolicy': 'never',
            'allowProviderModelFallback': False, 'work_prompt_capture': 'off', 'handoff_reminder': False}
DEVELOPER = ('Synthetic local evaluation. Stay within this fixture; use installed instructions and '
             './bin/anamnesis. Do not inspect evaluator files, credentials, unrelated projects, or '
             'external services. No delegation, commits, releases, Work/goal updates, or global '
             'settings changes. Only the requested task is authorized.')
TASKS = {
    'lookup': {'suite': 'development', 'file': 'records.json',
               'rows': [{'active': True, 'amount': 17}, {'active': False, 'amount': 90},
                        {'active': True, 'amount': -5}],
               'prompts': ['Read records.json. Return only JSON {"total":N}, summing amount for active rows. Preserve every file.'],
               'expected': [{'total': 12}]},
    'orientation': {'suite': 'development', 'prompts': [
        '/load-context. This is standalone: read the ontology, then stop without edits. Return only JSON with service, port, dependency, and lookup_source_mutation_allowed.'],
        'expected': [{'service': 'dispatch', 'port': 7319, 'dependency': 'inventory',
                      'lookup_source_mutation_allowed': False}]},
    'handoff': {'suite': 'development', 'prompts': [
        'Prepare a handoff using the installed procedure for: review the dispatch migration. '
        'Port 7319 and dependency inventory are confirmed in system_graph.yaml. Implementation '
        'has not started; next action is review migration. No blockers. Write archive and active '
        'index, then stop. Do not implement, commit, or update Work/goals. In the archive In flight '
        'section explicitly say "Implementation has not started".']},
    'lookup_signed': {'suite': 'reserved', 'file': 'ledger.json',
        'rows': [{'enabled': True, 'delta': -19}, {'enabled': False, 'delta': 800},
                 {'enabled': True, 'delta': 6}, {'enabled': True, 'delta': 0}],
        'prompts': ['Read ledger.json. Return only JSON {"total":N}, summing delta only where enabled is true. Preserve every file.'],
        'expected': [{'total': -13}]},
    'lookup_nested': {'suite': 'reserved', 'file': 'warehouse.json',
        'rows': {'entries': [{'state': 'live', 'units': 28}, {'state': 'retired', 'units': 901},
                             {'state': 'live', 'units': -11}]},
        'prompts': ['Read warehouse.json entries. Return only JSON {"total":N}, summing units only for state live. Preserve every file.'],
        'expected': [{'total': 17}]},
    'delayed': {'suite': 'reserved', 'prompts': [
        'Call await_records exactly once. Initially count every row. Follow subsequent user changes. '
        'Return only JSON {"total":N} after the result arrives. Preserve all files.'],
        'steer': 'Updated requirement: sum quantity for approved rows only; do not count rows. Preserve all files.',
        'response': {'rows': [{'approved': True, 'quantity': 13},
                             {'approved': False, 'quantity': 200},
                             {'approved': True, 'quantity': -4}],
                     'obsolete_rule': 'count all rows'}, 'expected': [{'total': 9}]},
    'warm_question': {'suite': 'reserved', 'file': 'pending.json',
        'rows': [{'approved': True, 'quantity': 21}, {'approved': False, 'quantity': 400},
                 {'approved': True, 'quantity': -8}],
        'prompts': [
            'Read pending.json. The pending task is sum quantity for approved rows only, preserving all files. '
            'Do not calculate yet. Return only JSON {"status":"pending"}.',
            'Side question: what is 28 plus 17? Return only JSON {"answer":N,"task_status":"pending"}. Keep the original task pending; do not calculate it yet.',
            'Continue the original pending task now. Return only JSON {"total":N}.'],
        'expected': [{'status': 'pending'}, {'answer': 45, 'task_status': 'pending'}, {'total': 13}]},
    'compaction': {'suite': 'reserved', 'file': 'pending.json',
        'rows': [{'approved': True, 'quantity': -12}, {'approved': False, 'quantity': 900},
                 {'approved': True, 'quantity': 5}],
        'prompts': [
            'Read pending.json. The pending task is sum quantity for approved rows only, preserving all files. '
            'Do not calculate yet. Return only JSON {"status":"pending"}.',
            'Continue the original pending task now, keeping its original filter and preservation constraint. Return only JSON {"total":N}.'],
        'compact_after': 0, 'expected': [{'status': 'pending'}, {'total': -7}]},
    'manual_fallback': {'suite': 'reserved', 'manual': True, 'prompts': [
        '/load-context. Native hooks and skills are unavailable. Use the installed manual fallback. '
        'This is standalone: read the ontology then stop without edits. Return only JSON with service, port, dependency, and lookup_source_mutation_allowed.'],
        'expected': [{'service': 'dispatch', 'port': 7319, 'dependency': 'inventory',
                      'lookup_source_mutation_allowed': False}]},
}
ORIGINAL_TASKS = TASKS.copy()

DYNAMIC_TOOLS = [{'type': 'function', 'name': 'await_records',
                  'description': 'Get delayed task rows.',
                  'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}}]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def identity(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def write_json(path, value, exclusive=False):
    with Path(path).open('x' if exclusive else 'w') as stream:
        json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write('\n')


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(Path(path).read_text(), object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def manifest(root):
    """All fixture entries, including Git, dotfiles, empty dirs, modes and links."""
    result = {}
    for path in sorted(Path(root).rglob('*')):
        key = path.relative_to(root).as_posix()
        mode = path.lstat().st_mode & 0o777
        if path.is_symlink():
            result[key] = {'kind': 'link', 'target': os.readlink(path), 'mode': mode}
        elif path.is_file():
            result[key] = {'kind': 'file', 'sha256': digest(path), 'mode': mode}
        elif path.is_dir():
            result[key] = {'kind': 'dir', 'mode': mode}
        else:
            raise ValueError('special fixture entry: ' + key)
    return result


def source_lock(src):
    # Lock executable package bytes; Vitest result bookkeeping is not a CLI input.
    # Include source, generated distribution and all fragment inputs, not only base.
    folders = ('cli/src', 'cli/dist', 'base', 'fragments', 'specs', 'node_modules')
    result = {str(p.relative_to(src)): digest(p) for folder in folders
              for p in sorted((src / folder).rglob('*')) if p.is_file()
              and not str(p.relative_to(src)).startswith('node_modules/.vite/vitest/')}
    for name in ('package.json', 'package-lock.json', 'rulebook.md'):
        if (src / name).is_file():
            result[name] = digest(src / name)
    require('cli/dist/index.js' in result, 'build source distribution before freeze')
    return result


def safe_fixture_path(name):
    require(isinstance(name, str) and bool(name) and "\\" not in name and "\0" not in name,
            'invalid fixture path')
    path = Path(name)
    require(bool(path.parts) and not path.is_absolute() and '..' not in path.parts and str(path) == name, 'unsafe fixture path')
    require(not any(part in {'.git', '.codex', '.agents', '.claude', '.cursor', '.omx', 'bin'} for part in path.parts) and
            path.name not in {'AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'Agentfile'} and
            all(part != '.anamnesis' or index + 2 < len(path.parts) and path.parts[index + 1] in {'ontology', 'handoff'}
                for index, part in enumerate(path.parts)),
            'protected fixture path')
    return name


def select_tasks(holdout=None):
    global TASKS
    if holdout is None:
        TASKS = ORIGINAL_TASKS.copy()
        return None
    path = Path(holdout).resolve()
    tasks = read_json(path)
    require(isinstance(tasks, dict) and len(tasks) == 8, 'fresh holdout requires exactly eight tasks')
    fields = {'suite', 'prompts', 'expected', 'fixture_files', 'expected_files', 'manual',
              'compact_after', 'steer', 'response', 'file', 'rows'}
    for task_id, task in tasks.items():
        require(re.fullmatch(r'fresh_[a-z0-9_]+', task_id) is not None and isinstance(task, dict), 'invalid fresh task')
        require(set(task) <= fields and task.get('suite') == 'reserved', 'invalid fresh task fields/suite')
        require(isinstance(task.get('prompts'), list) and task['prompts'] and
                all(isinstance(p, str) and p for p in task['prompts']), 'invalid fresh prompts')
        require(isinstance(task.get('expected'), list) and len(task['expected']) == len(task['prompts']) and
                all(isinstance(value, dict) for value in task['expected']), 'invalid fresh oracle')
        require(type(task.get('manual', False)) is bool, 'invalid manual flag')
        if 'compact_after' in task:
            require(type(task['compact_after']) is int and 0 <= task['compact_after'] < len(task['prompts']) - 1,
                    'invalid compaction boundary')
        require(('steer' in task) == ('response' in task), 'missing steering pair')
        if 'steer' in task:
            require(isinstance(task['steer'], str) and bool(task['steer']) and isinstance(task['response'], dict), 'invalid steering pair')
        require(('file' in task) == ('rows' in task), 'missing file data')
        if 'file' in task:
            safe_fixture_path(task['file'])
        require(isinstance(task.get('fixture_files', {}), dict) and isinstance(task.get('expected_files', {}), dict), 'invalid fixture mappings')
        require(task.get('file') not in task.get('fixture_files', {}), 'duplicate fixture source')
        for name, content in task.get('fixture_files', {}).items():
            safe_fixture_path(name)
            require(isinstance(content, str), 'fixture contents must be text')
        for name, oracle in task.get('expected_files', {}).items():
            safe_fixture_path(name)
            require(name in task.get('fixture_files', {}) and isinstance(oracle, dict) and
                    set(oracle) == {'format', 'value'} and oracle['format'] in {'json', 'text'}, 'invalid edit oracle')
            require(oracle['format'] != 'text' or isinstance(oracle['value'], str), 'invalid text oracle')
            require(not name.startswith('.anamnesis/'), 'managed state edits are not allowed by fresh fixtures')
    TASKS = {key: value for key, value in ORIGINAL_TASKS.items() if value['suite'] == 'development'} | tasks
    return {'path': str(path), 'sha256': digest(path)}


def git_revision(src):
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=src, text=True).strip()


def versions():
    return {name: {'version': subprocess.check_output([name, '--version'], text=True).strip(),
                   'executable': str(Path(shutil.which(name)).resolve()),
                   'sha256': digest(Path(shutil.which(name)).resolve())}
            for name in ('codex', 'node', 'git')}


def fixture(root, src, task, log):
    root.mkdir(parents=True)
    state = root.parent / 'setup-state'
    env = {**os.environ, 'ANAMNESIS_STATE_HOME': str(state),
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
    subprocess.run(['git', 'init', '-q', '--template=', '--initial-branch=fixture', str(root)], check=True)
    result = subprocess.run(['node', str(src / 'cli/dist/index.js'), 'init', '--tools', 'codex',
                             '--allow-exec-adapters', '--no-context-bootstrap'],
                            cwd=root, env=env, text=True, capture_output=True)
    Path(log).write_text(result.stdout + result.stderr)
    require(result.returncode == 0, 'fixture init failed; see setup log')
    # Isolate instruction delivery from separately validated Work capture and Stop-cache writes.
    subprocess.run(['node', '--input-type=module', '-e',
        "import fs from 'node:fs';import {pathToFileURL} from 'node:url';const {default:YAML}=await import(pathToFileURL(process.argv[2]).href);const p=process.argv[1];const a=YAML.parse(fs.readFileSync(p,'utf8'));a.settings.work_prompt_capture={preset:'off'};fs.writeFileSync(p,YAML.stringify(a));",
        str(root / 'Agentfile'), str(src / 'node_modules/yaml/dist/index.js')], check=True)
    (root / 'bin').mkdir(exist_ok=True)
    launcher = root / 'bin/anamnesis'
    launcher.write_text('#!/bin/sh\n: "${ANAMNESIS_STATE_HOME:?scoped state required}"\nexec node '
                        + shlex.quote(str(src / 'cli/dist/index.js')) + ' "$@"\n')
    launcher.chmod(0o755)
    (root / 'system_graph.yaml').write_text(
        'services:\n  - id: dispatch\n    port: 7319\n    depends_on: inventory\n'
        'invariants:\n  - Never modify source data during a lookup.\n')
    if 'file' in task:
        (root / task['file']).parent.mkdir(parents=True, exist_ok=True)
        write_json(root / task['file'], task['rows'])
    for name, content in task.get('fixture_files', {}).items():
        target = root / safe_fixture_path(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    if task.get('manual'):
        for name in ('.codex', '.claude', '.cursor'):
            path = root / name
            if path.exists():
                shutil.rmtree(path)
        path = root / '.anamnesis/codex-native-hooks'
        if path.exists():
            shutil.rmtree(path)
    # Fixed dates and identities; no random init Git template or user hooks.
    git_env = {**env, 'GIT_AUTHOR_NAME': 'Fixture', 'GIT_AUTHOR_EMAIL': 'fixture@example.invalid',
               'GIT_COMMITTER_NAME': 'Fixture', 'GIT_COMMITTER_EMAIL': 'fixture@example.invalid',
               'GIT_AUTHOR_DATE': '2000-01-01T00:00:00Z', 'GIT_COMMITTER_DATE': '2000-01-01T00:00:00Z'}
    subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', 'add', '--force', '-A'], cwd=root, env=git_env, check=True)
    subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
                    'commit', '-qm', 'Deterministic evaluation fixture'], cwd=root, env=git_env, check=True)
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()


def schedule(batch):
    runs = []
    for task_id, task in TASKS.items():
        for repetition in range(1, 4):
            # Alternating AB / BA produces ABBA across successive matched pairs.
            arms = ('baseline', 'candidate') if len(runs) // 2 % 2 == 0 else ('candidate', 'baseline')
            for arm in arms:
                runs.append({'run_id': f'{batch}-{task_id}-{repetition}-{arm}', 'task_id': task_id,
                             'suite': task['suite'], 'arm': arm, 'repetition': repetition,
                             'pair_id': f'{batch}-{task_id}-{repetition}', 'order': len(runs)})
    return runs


def selected_schedule(batch, suite='all'):
    require(suite in ('all', 'reserved'), 'invalid suite selection')
    selected = [r for r in schedule(batch) if suite == 'all' or r['suite'] == suite]
    return [{**r, 'order': i} for i, r in enumerate(selected)]


def freeze(args):
    out = args.output.resolve()
    require(re.fullmatch(r'[A-Za-z0-9_-]+', args.batch) is not None, 'unsafe batch ID')
    out.mkdir(parents=True, exist_ok=False)
    record = {'status': 'freezing', 'errors': []}
    write_json(out / 'freeze-result.json', record)
    try:
        holdout = select_tasks(getattr(args, 'holdout', None))
        sources = {arm: {'path': str(path.resolve()), 'git_ref': git_revision(path.resolve()),
                         'files': source_lock(path.resolve())}
                   for arm, path in [('baseline', args.baseline), ('candidate', args.candidate)]}
        require(sources['baseline']['git_ref'] == BASELINE_REF, 'baseline is not protocol PR7 commit')
        plan = {'schema': 2, 'batch': args.batch, 'classification': 'FORMAL', 'settings': SETTINGS,
                'developer': DEVELOPER, 'tasks': TASKS, 'dynamic_tools': DYNAMIC_TOOLS,
                'sources': sources, 'versions': versions(), 'holdout': holdout,
                'harness': digest(Path(__file__)),
                'runtime': digest(Path(__file__).with_name('codex_continuity_runtime.py')),
                'protocol': {'path': str(args.protocol.resolve()), 'sha256': digest(args.protocol)},
                'thresholds': {'token': 0.90, 'time': 1.05},
                'second_batch': 'No replacement/retry. Independently prefreeze any second batch before viewing outcomes; report both.',
                'selected_suite': getattr(args, 'suite', 'all'),
                'runs': selected_schedule(args.batch, getattr(args, 'suite', 'all'))}
        for sample in plan['runs']:
            record['sample'] = sample['run_id']
            write_json(out / 'freeze-result.json', record)
            folder = out / 'runs' / sample['run_id']
            folder.mkdir(parents=True)
            sample['git_ref'] = fixture(folder / 'fixture', Path(sources[sample['arm']]['path']),
                                        TASKS[sample['task_id']], folder / 'setup.log')
            sample['fixture'] = manifest(folder / 'fixture')
            # Retain the actual original bytes, not just trusted score summaries.
            shutil.copytree(folder / 'fixture', folder / 'frozen-fixture', symlinks=True)
        plan['plan_id'] = identity(plan)
        write_json(out / 'plan.json', plan, exclusive=True)
        record['status'] = 'frozen'
        record['plan_id'] = plan['plan_id']
        print(json.dumps({'plan_id': plan['plan_id'], 'output': str(out)}))
    except Exception as error:
        record['status'] = 'failed'
        record['errors'].append(repr(error))
        raise
    finally:
        write_json(out / 'freeze-result.json', record)


def load_plan(out, expected_id, execution_harness=None):
    plan = read_json(out / 'plan.json')
    require(plan.get('plan_id') == expected_id, 'external frozen plan identity mismatch')
    unsigned = {k: v for k, v in plan.items() if k != 'plan_id'}
    require(plan.get('plan_id') == identity(unsigned), 'altered plan identity')
    require(plan.get('schema') == 2 and plan.get('classification') == 'FORMAL', 'pilot/invalid plan')
    holdout = plan.get('holdout')
    require(select_tasks(holdout['path'] if holdout else None) == holdout, 'holdout changed after freeze')
    require(plan['tasks'] == TASKS and plan['settings'] == SETTINGS and plan['developer'] == DEVELOPER
            and plan['dynamic_tools'] == DYNAMIC_TOOLS, 'changed formal contract')
    require(plan['thresholds'] == {'token': .90, 'time': 1.05}, 'changed thresholds')
    expected = selected_schedule(plan['batch'], plan.get('selected_suite', 'all'))
    require([{k: r[k] for k in expected[0]} for r in plan['runs']] == expected, 'invalid sample manifest/order')
    require(plan['harness'] == digest(Path(execution_harness) if execution_harness else Path(__file__)), 'harness changed after freeze')
    require(plan['runtime'] == digest(Path(__file__).with_name('codex_continuity_runtime.py')), 'runtime changed')
    require(digest(plan['protocol']['path']) == plan['protocol']['sha256'], 'protocol changed')
    require(versions() == plan['versions'], 'CLI/tool versions changed')
    require(plan['sources']['baseline']['git_ref'] == BASELINE_REF, 'incorrect protocol baseline')
    for source in plan['sources'].values():
        require(git_revision(Path(source['path'])) == source['git_ref'], 'source revision changed')
        require(source_lock(Path(source['path'])) == source['files'], 'source changed after freeze')
    for sample in plan['runs']:
        require(manifest(out / 'runs' / sample['run_id'] / 'frozen-fixture') == sample['fixture'], 'frozen fixture changed')
    return plan


def handoff_valid(root, git_ref):
    directory = root / '.anamnesis/handoff'
    files = list(directory.glob('*.md'))
    active = directory / 'active.md'
    archives = [p for p in files if p != active]
    require(active.is_file() and len(archives) == 1 and len(files) == 2, 'handoff requires one archive and index')
    require(not directory.is_symlink() and all(p.is_file() and not p.is_symlink() for p in files), 'handoff must contain regular files')
    archive = archives[0]
    require(re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ\.md', archive.name), 'archive timestamp filename')
    for path, date_key in [(archive, 'created'), (active, 'updated')]:
        text = path.read_text()
        fm = re.match(r'\A---\n(.*?)\n---\n', text, re.S)
        require(fm is not None, 'missing handoff frontmatter')
        metadata = dict(re.findall(r'^([a-z_]+):\s*["\']?([^\n"\']+)["\']?$', fm[1], re.M))
        require(metadata.get('git_ref') == git_ref and metadata.get('agent') == 'codex', 'handoff metadata mismatch')
        datetime.datetime.fromisoformat(metadata[date_key].replace('Z', '+00:00'))
    text = archive.read_text()
    headings = ['Goal', 'Done so far', 'In flight', 'Decisions', 'Open questions / blockers', 'Next steps']
    positions = [text.find('## ' + h + '\n') for h in headings]
    require(all(p >= 0 for p in positions) and positions == sorted(positions), 'handoff sections/order')
    sections = {h: text[p + len(h) + 4:positions[i + 1] if i + 1 < len(positions) else len(text)].strip()
                for i, (h, p) in enumerate(zip(headings, positions))}
    require(all(sections.values()), 'empty handoff section')
    require('implementation has not started' in sections['In flight'].lower(), 'wrong task status')
    require(all(word in text for word in ['dispatch', '7319', 'inventory', 'system_graph.yaml']), 'handoff facts missing')
    require('review' in sections['Next steps'].lower() and 'migration' in sections['Next steps'].lower(), 'wrong next action')
    index = active.read_text()
    require(all('## ' + h + '\n' in index for h in ['Current focus', 'Active tasks', 'Recently completed']), 'index sections')
    pointer = '.anamnesis/handoff/' + archive.name
    require(pointer in index.split('## Recently completed')[0] and '[in-flight]' in index, 'active archive pointer/status')
    return {'.anamnesis/handoff', '.anamnesis/handoff/active.md', pointer}


def score(task, root, answers, before, git_ref):
    try:
        after = manifest(root)
        is_handoff = 'expected' not in task
        allowed = handoff_valid(root, git_ref) if is_handoff else set(task.get('expected_files', {}))
        for name, oracle in task.get('expected_files', {}).items():
            safe_fixture_path(name)
            require(before.get(name, {}).get('kind') == 'file' and after.get(name, {}).get('kind') == 'file' and
                    before[name]['mode'] == after[name]['mode'], 'invalid edited-file identity/mode')
            actual = read_json(root / name) if oracle['format'] == 'json' else (root / name).read_text()
            require(identity(actual) == identity(oracle['value']), 'incorrect edited-file contents')
        changed = {name for name in before.keys() | after.keys() if before.get(name) != after.get(name)}
        require(changed <= allowed, 'prohibited fixture mutations: ' + ', '.join(sorted(changed - allowed)))
        if is_handoff:
            require(not any(name in before for name in allowed if name != '.anamnesis/handoff'), 'handoff overwrote input')
        if 'expected' in task:
            require(len(answers) == len(task['expected']), 'missing/extra final answers')
            # Strict types: Python equality otherwise admits false == 0 and true == 1.
            require([identity(json.loads(a)) for a in answers] == [identity(a) for a in task['expected']], 'incorrect structured answer')
        return {'pass': True}
    except (ValueError, KeyError, OSError, TypeError) as error:
        return {'pass': False, 'error': str(error)}


def state_snapshot(root):
    if not root.exists() and not root.is_symlink():
        return None
    metadata = {"mode": root.lstat().st_mode, "link": os.readlink(root) if root.is_symlink() else None}
    return {"root": metadata, "entries": manifest(root)}


def thread_params(root, task):
    return {'model': MODEL, 'allowProviderModelFallback': False, 'cwd': str(root),
            'approvalPolicy': 'never', 'sandbox': 'workspace-write', 'ephemeral': False,
            'developerInstructions': DEVELOPER, 'dynamicTools': DYNAMIC_TOOLS if 'steer' in task else [],
            'experimentalRawEvents': True,
            'config': {'model_reasoning_effort': 'high', 'features.context_management': False,
                       'sandbox_workspace_write.writable_roots': [str(root), str(root.parent / 'home/anamnesis-state')],
                       'sandbox_workspace_write.network_access': False,
                       'sandbox_workspace_write.exclude_tmpdir_env_var': True,
                       'sandbox_workspace_write.exclude_slash_tmp': True}}


async def execute(out, plan, sample, runtime_class=Runtime):
    folder = out / 'runs' / sample['run_id']
    root = folder / 'fixture'
    result_path = folder / 'result.json'
    result = {'plan_id': plan['plan_id'], 'sample': {k: sample[k] for k in schedule(plan['batch'])[0]},
              'started_ns': time.time_ns(), 'status': 'started', 'errors': {}, 'turns': []}
    write_json(result_path, result, exclusive=True)
    runtime = None
    phase = 'setup'
    try:
        require(manifest(root) == sample['fixture'], 'fixture changed before run')
        result['state_before'] = state_snapshot(folder / 'home/anamnesis-state')
        require(result['state_before'] is None, 'state exists before fresh run')
        task = plan['tasks'][sample['task_id']]
        runtime = runtime_class(folder / 'home', root, folder / 'events.jsonl', context=False)
        os.environ['ANAMNESIS_HANDOFF_REMINDER'] = '0'
        result['runtime_environment'] = {'ANAMNESIS_HANDOFF_REMINDER': '0'}
        await runtime.start()
        result['hooks'] = await runtime.trust()
        result['request'] = thread_params(root, task)
        result['thread_start'] = await runtime.request('thread/start', result['request'])
        result['config'] = await runtime.request('config/read', {'cwd': str(root), 'includeLayers': True})
        require(result['thread_start']['model'] == MODEL, 'model mismatch')
        runtime.tid = result['thread_start']['thread']['id']
        result['thread_id'] = runtime.tid
        result['steering'] = []

        async def callback(event):
            require(event.get('method') == 'item/tool/call', 'unexpected server request')
            params = event['params']
            require('steer' in task and params['tool'] == 'await_records' and not result['steering'], 'unexpected/duplicate dynamic tool')
            entry = {'request_id': event['id'], 'turn_id': params['turnId'], 'sent_ns': time.time_ns(),
                     'prompt': task['steer']}
            result['steering'].append(entry)
            entry['response'] = await runtime.request('turn/steer', {
                'threadId': runtime.tid, 'expectedTurnId': params['turnId'],
                'input': [{'type': 'text', 'text': task['steer'], 'text_elements': []}]})
            await asyncio.sleep(.3)
            entry['released_ns'] = time.time_ns()
            entry['tool_response'] = task['response']
            await runtime.send({'id': event['id'], 'result': {'contentItems': [
                {'type': 'inputText', 'text': json.dumps(task['response'])}], 'success': True}})

        runtime.callbacks = callback
        phase = 'turn'
        start = time.monotonic()
        for index, prompt in enumerate(task['prompts']):
            turn = await runtime.turn(prompt, effort='high')
            result['turns'].append({**turn, 'prompt': prompt, 'kind': 'startup' if index == 0 else 'warm'})
            require(turn['status'] == 'completed', 'turn did not complete')
            if task.get('compact_after') == index:
                result['compaction'] = await runtime.compact()
        result['elapsed_s'] = time.monotonic() - start
        result['status'] = 'completed'
    except Exception as error:
        result['errors'][phase] = repr(error)
        result['status'] = 'failed'
    finally:
        try:
            if runtime is not None:
                await runtime.stop()
        except Exception as error:
            result['errors']['cleanup'] = repr(error)
            result['status'] = 'failed'
        try:
            result['state_after'] = state_snapshot(folder / 'home/anamnesis-state')
            result['after'] = manifest(root)
            result['session_files'] = {str(p.relative_to(folder)): digest(p)
                                       for p in sorted((folder / 'home/sessions').rglob('*.jsonl'))}
            result['home_config_sha256'] = digest(folder / 'home/config.toml') if (folder / 'home/config.toml').exists() else None
            result['events_sha256'] = digest(folder / 'events.jsonl') if (folder / 'events.jsonl').exists() else None
        except Exception as error:
            result['errors']['evidence'] = repr(error)
            result['status'] = 'failed'
        result['ended_ns'] = time.time_ns()
        write_json(result_path, result)
    return result


async def run(args):
    out = args.output.resolve()
    # Retain rejected invocations too: changing a source or retrying a failed sample
    # cannot silently disappear from the formal attempt history.
    lock = out / 'run.lock'
    acquired = False
    try:
        with lock.open('x') as stream:
            stream.write(str(os.getpid()))
        acquired = True
        plan = load_plan(out, args.plan_id)
        target = next((r for r in plan['runs'] if r['run_id'] == args.run_id), None)
        require(target is not None, 'unknown run ID')
        for sample in plan['runs']:
            exists = (out / 'runs' / sample['run_id'] / 'result.json').exists()
            require(exists if sample['order'] < target['order'] else not exists, 'run order/retry violation')
        await execute(out, plan, target)
    except Exception as error:
        write_json(out / ('rejected-' + str(time.time_ns()) + '.json'),
                   {'run_id': args.run_id, 'plan_id': args.plan_id, 'error': repr(error)}, exclusive=True)
        raise
    finally:
        if acquired:
            lock.unlink()


def finite_positive(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def evidence(folder, plan, sample):
    result = read_json(folder / 'result.json')
    require(result.get('runtime_environment') == {'ANAMNESIS_HANDOFF_REMINDER': '0'}, 'runtime environment mismatch')
    require(result['plan_id'] == plan['plan_id'] and result['sample'] == {
        k: sample[k] for k in schedule(plan['batch'])[0]}, 'run identity mismatch')
    require(result['status'] == 'completed' and not result['errors'], 'recorded run failure')
    require('state_before' in result and result['state_before'] is None and
            result.get('state_after') == result['state_before'] and
            state_snapshot(folder / 'home/anamnesis-state') == result['state_after'], 'unauthorized external state mutation')
    require(type(result['started_ns']) is int and result['ended_ns'] > result['started_ns'], 'invalid timing boundary')
    require(finite_positive(result['elapsed_s']), 'invalid elapsed time')
    require(digest(folder / 'events.jsonl') == result['events_sha256'], 'raw events changed')
    events = [json.loads(line) for line in (folder / 'events.jsonl').read_text().splitlines()]
    tid = result['thread_id']
    require(result['thread_start']['model'] == MODEL and result['thread_start']['thread']['id'] == tid, 'thread/model mismatch')
    task = plan['tasks'][sample['task_id']]
    require(result['request'] == thread_params(folder / 'fixture', task), 'execution settings mismatch')
    config = result['config']['config']
    require(config.get('model') == MODEL and config.get('model_reasoning_effort') == 'high', 'effective model/effort absent or mismatched')
    require(config.get('features', {}).get('context_management') is False, 'effective context management absent or mismatched')
    sandbox = result['thread_start'].get('sandbox', {})
    require(sandbox.get('type') == 'workspaceWrite' and sandbox.get('networkAccess') is False
            and sandbox.get('excludeTmpdirEnvVar') is True and sandbox.get('excludeSlashTmp') is True
            and set(sandbox.get('writableRoots', [])) | {str(folder / 'fixture')} == {str(folder / 'fixture'), str(folder / 'home/anamnesis-state')}
            and result['thread_start'].get('cwd') == str(folder / 'fixture'),
            'effective fixture/state sandbox boundary absent or mismatched')
    require(result['thread_start'].get('approvalPolicy') == 'never', 'effective approval mismatch')
    require(digest(folder / 'home/config.toml') == result['home_config_sha256'], 'runtime config changed')
    session_files = {str(p.relative_to(folder)): digest(p) for p in sorted((folder / 'home/sessions').rglob('*.jsonl'))}
    require(session_files and session_files == result['session_files'], 'missing/altered session provenance')
    contexts = []
    for filename in session_files:
        records = [json.loads(line) for line in (folder / filename).read_text().splitlines()]
        meta = [r['payload'] for r in records if r.get('type') == 'session_meta']
        require(len(meta) == 1 and meta[0]['id'] == tid, 'unexpected session thread')
        contexts += [r['payload'] for r in records if r.get('type') == 'turn_context']
    require(contexts and all(c.get('model') == MODEL and c.get('effort', c.get('reasoning_effort')) == 'high' for c in contexts), 'session model/effort mismatch')
    if task.get('manual'):
        require(not result['hooks']['data'][0]['hooks'], 'manual fixture discovered native hooks')
        require(not any(name.startswith(('.codex/', '.claude/', '.cursor/')) for name in sample['fixture']), 'manual native discovery available')
    turns = result['turns']
    require([t['prompt'] for t in turns] == task['prompts'], 'prompt evidence mismatch')
    turn_ids = [t['turn_id'] for t in turns]
    require(len(set(turn_ids)) == len(turn_ids), 'duplicate turn ID')
    require(set(turn_ids) <= {c.get('turn_id') for c in contexts}, 'missing per-turn model provenance')
    require(all(t['status'] == 'completed' and finite_positive(t['elapsed_s']) for t in turns), 'bad turn')
    require(sum(t['elapsed_s'] for t in turns) <= result['elapsed_s'] + .001, 'whole-thread timing excludes turns')
    own = [e for e in events if e.get('params', {}).get('threadId') == tid]
    # Any additional model thread (delegation) invalidates the scored sample.
    require(not any(e.get('method') == 'thread/tokenUsage/updated' and e['params']['threadId'] != tid for e in events), 'extra model thread')
    completed = [e['params'] for e in own if e.get('method') == 'item/completed']
    require(not any(p['item'].get('type', '').startswith('collab') for p in completed), 'delegation detected')
    finals = [p for p in completed if p['item'].get('type') == 'agentMessage' and p['item'].get('phase') == 'final_answer']
    require([p['turnId'] for p in finals] == turn_ids, 'final_answer turn coverage/order mismatch')
    answers = [p['item']['text'] for p in finals]
    compactions = [p for p in completed if p['item'].get('type') == 'contextCompaction']
    require(len(compactions) == (1 if 'compact_after' in task else 0), 'unexpected/missing compaction')
    allowed_turns = turn_ids + [p['turnId'] for p in compactions]
    done = [e['params']['turn'] for e in own if e.get('method') == 'turn/completed']
    require(sorted(t['id'] for t in done) == sorted(allowed_turns) and all(t['status'] == 'completed' for t in done), 'raw turn coverage/status mismatch')
    if compactions:
        require(result.get('compaction', {}).get('params') == compactions[0], 'compaction evidence mismatch')
        require(allowed_turns[-1] not in turn_ids, 'invalid compaction turn')
        index = task['compact_after']
        require(type(index) is int and 0 <= index < len(turn_ids), 'invalid compaction position')
        expected_order = turn_ids[:index + 1] + [allowed_turns[-1]] + turn_ids[index + 1:]
        require([e['params']['turn']['id'] for e in own if e.get('method') == 'turn/completed'] == expected_order, 'uncontrolled compaction ordering')
    dynamic = [e for e in own if e.get('method') == 'item/tool/call']
    require(len(dynamic) == (1 if 'steer' in task else 0), 'dynamic tool coverage mismatch')
    if dynamic:
        steer = result['steering']
        require(len(steer) == 1 and steer[0]['request_id'] == dynamic[0]['id'] and
                steer[0]['prompt'] == task['steer'] and steer[0]['tool_response'] == task['response'] and
                steer[0]['released_ns'] - steer[0]['sent_ns'] >= 300_000_000 and
                steer[0]['response']['turnId'] == turn_ids[0], 'invalid delayed steering evidence')
    usage = [e['params'] for e in own if e.get('method') == 'thread/tokenUsage/updated']
    require(usage and usage[-1]['turnId'] == turn_ids[-1], 'missing final cumulative usage')
    totals = [u['tokenUsage']['total'] for u in usage]
    keys = ['totalTokens', 'inputTokens', 'outputTokens', 'cachedInputTokens']
    for total in totals:
        require(all(type(total.get(k)) is int and total[k] >= 0 for k in keys), 'invalid token values')
        require(total['totalTokens'] == total['inputTokens'] + total['outputTokens'] and
                total['cachedInputTokens'] <= total['inputTokens'], 'inconsistent usage')
    require(all(b['totalTokens'] >= a['totalTokens'] for a, b in zip(totals, totals[1:])), 'cumulative usage regressed')
    require(totals[-1]['totalTokens'] > 0, 'zero total usage')
    raw = [e['params'] for e in own if e.get('method') == 'rawResponse/completed']
    require(raw and len({r['responseId'] for r in raw}) == len(raw), 'missing/duplicate raw responses')
    require(set(allowed_turns) == {r['turnId'] for r in raw}, 'raw response turn coverage')
    for response in raw:
        value = response['usage']
        require(all(type(value.get(k)) is int and value[k] >= 0 for k in keys) and
                value['totalTokens'] == value['inputTokens'] + value['outputTokens'] and
                value['cachedInputTokens'] <= value['inputTokens'], 'invalid raw response usage')
    response_totals = {k: sum(r['usage'][k] for r in raw) for k in keys}
    compact_totals = {k: sum(r['usage'][k] for r in raw if r['turnId'] in allowed_turns[len(turn_ids):]) for k in keys}
    require(all(response_totals[k] == totals[-1][k] + compact_totals[k] for k in keys), 'raw and final cumulative usage disagree')
    timed = [e for e in own if e.get('method') in ('turn/started', 'turn/completed')]
    require(all(finite_positive(e.get('time')) for e in timed), 'raw event timing missing')
    span = max(e['time'] for e in timed) - min(e['time'] for e in timed)
    require(0 < span <= result['elapsed_s'] + .1 and result['elapsed_s'] <= (result['ended_ns'] - result['started_ns']) / 1e9, 'raw timing does not fit measured boundaries')
    require(manifest(folder / 'fixture') == result['after'], 'post-run fixture changed')
    scored = score(task, folder / 'fixture', answers, sample['fixture'], sample['git_ref'])
    require(scored['pass'], 'quality failure: ' + scored.get('error', ''))
    return {'tokens': response_totals, 'cumulative_tokens': totals[-1], 'elapsed_s': result['elapsed_s'], 'raw_response_tokens': response_totals,
            'controlled_compaction_tokens': compact_totals,
            'turns': [{'kind': t['kind'], 'elapsed_s': t['elapsed_s']} for t in turns],
            'tool_calls': sum(p['item'].get('type') not in ('agentMessage', 'reasoning', 'userMessage', 'contextCompaction') for p in completed) + len(dynamic),
            'started_ns': result['started_ns'], 'ended_ns': result['ended_ns'], 'thread_id': tid}


def aggregate(plan, samples):
    pairs = []
    for baseline in (r for r in plan['runs'] if r['arm'] == 'baseline'):
        candidate = next(r for r in plan['runs'] if r['pair_id'] == baseline['pair_id'] and r['arm'] == 'candidate')
        a, b = samples[baseline['run_id']], samples[candidate['run_id']]
        pairs.append({'pair_id': baseline['pair_id'], 'task_id': baseline['task_id'], 'suite': baseline['suite'],
                      'token_ratio': b['tokens']['totalTokens'] / a['tokens']['totalTokens'],
                      'time_ratio': b['elapsed_s'] / a['elapsed_s']})
    suites = {}
    suite_names = ('reserved',) if plan.get('selected_suite') == 'reserved' else ('development', 'reserved')
    for suite in suite_names:
        selected = [p for p in pairs if p['suite'] == suite]
        token = statistics.median(p['token_ratio'] for p in selected)
        elapsed = statistics.median(p['time_ratio'] for p in selected)
        suites[suite] = {'median_token_ratio': token, 'median_time_ratio': elapsed,
                         'pass': token <= .90 and elapsed <= 1.05}
    return {'pairs': pairs, 'suites': suites, 'scope': plan.get('selected_suite', 'all'),
            'complete_efficiency_proof': plan.get('selected_suite', 'all') == 'all' and all(s['pass'] for s in suites.values()),
            'pass': all(s['pass'] for s in suites.values())}


def audit(args):
    out = args.output.resolve()
    report = {'pass': False, 'errors': [], 'samples': {}, 'review_usage': 'excluded; not collected by this task runner'}
    try:
        execution_harness = getattr(args, 'execution_harness', None)
        plan = load_plan(out, args.plan_id, execution_harness=execution_harness)
        report['execution_harness_sha256'] = plan['harness']
        report['validation_harness_sha256'] = digest(Path(__file__))
        require(not list(out.glob('rejected-*.json')), 'rejected attempts recorded; retain and report this invalid batch')
        expected = {r['run_id'] for r in plan['runs']}
        folders = {p.name for p in (out / 'runs').iterdir()}
        require(folders == expected, 'extra/missing run directories')
        files = list(out.rglob('result.json'))
        require({p.parent.name for p in files} == expected and len(files) == len(expected), 'missing/extra/duplicate results')
        previous = 0
        threads = set()
        for sample in plan['runs']:
            try:
                data = evidence(out / 'runs' / sample['run_id'], plan, sample)
                require(data['started_ns'] >= previous, 'nonsequential/counterbalance order violation')
                require(data['thread_id'] not in threads, 'thread reused across samples')
                threads.add(data['thread_id'])
                previous = data['ended_ns']
                report['samples'][sample['run_id']] = data
            except Exception as error:
                report['errors'].append({'run_id': sample['run_id'], 'error': str(error)})
        if not report['errors']:
            report.update(aggregate(plan, report['samples']))
    except Exception as error:
        report['errors'].append({'error': str(error)})
    if getattr(args, 'execution_harness', None):
        # Never replace original grading or a previous corrected report.
        with (out / 'audit.corrected.json').open('x') as stream:
            stream.write(json.dumps(report, indent=2) + '\n')
    else:
        write_json(out / 'audit.json', report)
    print(json.dumps(report, indent=2))
    return 0 if report['pass'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='action', required=True)
    f = subs.add_parser('freeze')
    f.add_argument('--baseline', type=Path, required=True)
    f.add_argument('--candidate', type=Path, required=True)
    f.add_argument('--protocol', type=Path, required=True)
    f.add_argument('--batch', required=True)
    f.add_argument('--output', type=Path, required=True)
    f.add_argument('--suite', choices=('all', 'reserved'), default='all', help='Reserved-only pass is not complete efficiency proof')
    f.add_argument('--holdout', type=Path, help='Frozen independently authored fresh reserved specification')
    r = subs.add_parser('run')
    r.add_argument('--output', type=Path, required=True)
    r.add_argument('--run-id', required=True)
    r.add_argument('--plan-id', required=True)
    a = subs.add_parser('audit')
    a.add_argument('--output', type=Path, required=True)
    a.add_argument('--plan-id', required=True)
    a.add_argument('--execution-harness', type=Path, help='Original frozen execution artifact for an explicitly corrected audit; never used by run')
    args = parser.parse_args()
    if args.action == 'freeze':
        freeze(args)
    elif args.action == 'run':
        asyncio.run(run(args))
    else:
        return audit(args)
    return 0


if __name__ == '__main__':
    sys.exit(main())
