"""Render recorded evidence only: uv run --with matplotlib render-chart.py [preview.png]."""
import json
import sys
from pathlib import Path
from statistics import mean

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

ROOT = Path(__file__).resolve().parent
results = json.loads((ROOT / 'results.json').read_text())
summary = json.loads((ROOT / 'summary.json').read_text())
labels = ['Known-source read', 'Known-source edit', 'Missing / stale evidence', 'Missing-path recovery']
assert len(results) == 22 and all(row['passed'] for row in results)
rows = []
for row in summary:
    arms = {}
    for version in ['1.24.3', 'candidate']:
        runs = sorted((r for r in results if r['scenario'] == row['scenario'] and r['version'] == version), key=lambda r: r['repetition'])
        tokens = [r['usage']['input_tokens'] + r['usage']['output_tokens'] for r in runs]
        seconds = [r['elapsed_seconds'] for r in runs]
        assert abs(mean(tokens) - row['versions'][version]['total_tokens']) < .001
        assert abs(mean(seconds) - row['versions'][version]['elapsed_seconds']) < .001
        arms[version] = {'tokens': tokens, 'seconds': seconds}
    delta = 100 * (mean(arms['candidate']['tokens']) / mean(arms['1.24.3']['tokens']) - 1)
    latency = 100 * (mean(arms['candidate']['seconds']) / mean(arms['1.24.3']['seconds']) - 1)
    assert abs(delta - row['total_tokens_delta_pct']) < .011
    assert abs(latency - row['elapsed_seconds_delta_pct']) < .011
    rows.append((arms, delta, latency))

plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'svg.fonttype': 'none', 'svg.hashsalt': 'anamnesis-retrieval-batching'})
fig, (ax, timing) = plt.subplots(1, 2, figsize=(13, 6.5), gridspec_kw={'width_ratios': [1.7, 1]})
fig.subplots_adjust(left=.22, right=.96, top=.72, bottom=.28, wspace=.27)
colors = ['#64748b', '#0f766e']
for i, (arms, delta, latency) in enumerate(rows):
    for j, version in enumerate(['1.24.3', 'candidate']):
        y = i + [-.17, .17][j]
        values = arms[version]['tokens']
        ax.barh(y, mean(values)/1000, height=.27, color=colors[j], label=['Released 1.24.3 policy', 'Base v29 candidate'][j] if i == 0 else None)
        ax.scatter([t/1000 for t in values], [y]*len(values), s=18, facecolors='white', edgecolors='#172033', linewidths=.65, zorder=4)
    ax.text(123, i, f'{delta:+.1f}%', va='center', ha='left', color='#172033', weight='bold')
    timing.barh(i, latency, height=.46, color='#b45309' if latency > 0 else '#0f766e')
    timing.text(latency + (1 if latency >= 0 else -1), i, f'{latency:+.1f}%', va='center', ha='left' if latency >= 0 else 'right', weight='bold', color='#172033')
for panel in [ax, timing]:
    panel.set_ylim(3.65, -.6)
    panel.axhline(2.5, color='#cbd5e1', linestyle='--', linewidth=1)
    panel.spines[['top', 'right', 'left']].set_visible(False)
    panel.tick_params(axis='y', length=0)
ax.set_xlim(0, 145)
ax.set_xticks([0, 30, 60, 90, 120])
ax.set_yticks(range(4), [f'{label}\n{3 if i < 3 else 2} pairs' for i, label in enumerate(labels)])
ax.set_xlabel('Mean total tokens per run (thousands; includes cached input)')
ax.set_title('Token usage · dots show individual runs', loc='left', pad=17, weight='bold')
ax.legend(loc='lower left', bbox_to_anchor=(-.01, 1.15), frameon=False, ncol=2, fontsize=9)
timing.set_xlim(-36, 13)
timing.set_yticks([])
timing.set_xticks([-30, -15, 0, 10])
timing.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f'{v:+.0f}%' if v else '0%'))
timing.axvline(0, color='#94a3b8', linewidth=1)
timing.set_title('Elapsed time · diagnostic only', loc='left', pad=17, weight='bold')
timing.set_xlabel('Change in mean time (lower is better)')
fig.text(.035, .95, 'Retrieval batching: measured policy changes', fontsize=21, weight='bold', color='#172033')
fig.text(.035, .897, 'GPT-6 Astra / HIGH reasoning  |  1.24.3 policy vs base v29 candidate  |  22/22 task + source checks passed', fontsize=11, color='#334155')
fig.text(.035, .17, '2026-09-17 · Three main scenarios (3 pairs each) + separate missing-path recovery holdout (2 pairs).', fontsize=10)
fig.text(.035, .12, 'Percentages compare means, not median paired ratios. Fixed 1.24.3 retrieval engine; shared AGENTS policy only.', fontsize=10)
fig.text(.035, .07, 'Small pilot; caches and timing uncontrolled. No low-effort, billing-savings, or native-startup performance claim.', fontsize=10)
fig.savefig(ROOT / 'retrieval-batching-summary.svg', metadata={'Date': None}, facecolor='white')
svg = ROOT / 'retrieval-batching-summary.svg'
svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines())+'\n')
if len(sys.argv) > 1:
    fig.savefig(sys.argv[1], dpi=150, facecolor='white')
