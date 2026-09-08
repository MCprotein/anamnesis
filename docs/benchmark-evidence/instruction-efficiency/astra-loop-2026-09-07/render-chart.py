"""Render existing results only: uv run --with matplotlib render-chart.py."""
import json
import sys
from pathlib import Path
from statistics import median
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent
v6 = json.loads((ROOT / "results.json").read_text())
v8 = json.loads((ROOT / "work-completion-v8.json").read_text())
rows = []
for suite, label in [("development", "V6 development\n9 pairs / 18 runs"), ("reserved", "V6 fresh reserved\n24 pairs / 48 runs")]:
    pairs = [p for p in v6["pairs"] if p["suite"] == suite]
    values = [median(p[k] for p in pairs) for k in ["token_ratio", "time_ratio"]]
    assert all(abs(values[i] - v6["suites"][suite][k]) < 1e-12 for i, k in enumerate(["median_token_ratio", "median_time_ratio"]))
    rows.append((label, values))
rows.append(("V8 vs V7 tuned follow-up\n2 pairs / 4 runs", [median(p[k] for p in v8["pairs"]) for k in ["token_ratio", "time_ratio"]]))
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "svg.fonttype": "none", "svg.hashsalt": "anamnesis-astra"})
fig, ax = plt.subplots(figsize=(11, 5.7))
fig.subplots_adjust(left=.29, right=.90, top=.78, bottom=.25)
for row, (label, values) in enumerate(rows):
    for offset, value, color, name in zip([-.16, .16], values, ["#2563eb", "#d97706"], ["Total tokens", "Elapsed time"]):
        change = (value - 1) * 100
        ax.barh(row + offset, change, height=.27, color=color, label=name if row == 0 else None)
        ax.text(change + (-.55 if change < 0 else .55), row + offset, f"{change:+.1f}%", va="center", ha="right" if change < 0 else "left", fontweight="bold", color="#172033")
ax.axvline(0, color="#64748b", linewidth=1)
ax.axhline(1.5, color="#cbd5e1", linestyle="--")
ax.set_yticks(range(3), [r[0] for r in rows]); ax.invert_yaxis()
ax.set_xlim(-33, 7); ax.set_xticks([-30,-20,-10,0,5], ["-30%","-20%","-10%","0%","+5%"])
ax.set_xlabel("Median paired change vs each study's baseline (lower is better)")
ax.spines[["top", "right", "left"]].set_visible(False)
ax.legend(loc="lower left", bbox_to_anchor=(0,1.05), ncol=2, frameon=False)
fig.text(.04,.95,"GPT-6 Astra: measured instruction-efficiency results", fontsize=18, weight="bold")
fig.text(.04,.895,"Codex 0.153.4 / high reasoning  |  Both arms use anamnesis; not an on/off comparison", fontsize=11)
fig.text(.04,.13,"V6: Work capture and Stop reminders off. Fresh reserved tasks were outcome-unseen, not content-blind.",fontsize=10)
fig.text(.04,.09,"V8: Work enabled; tuned scenario, not independent holdout. Separate baselines; do not pool results.",fontsize=10)
fig.text(.04,.05,"Reserved time increased 1.8%. No general speedup, monetary-cost saving, or confidence interval is established.",fontsize=10)
fig.savefig(ROOT / "astra-summary.svg", metadata={"Date": None}, facecolor="white")
svg = ROOT / "astra-summary.svg"
svg.write_text("\n".join(line.rstrip() for line in svg.read_text().splitlines()) + "\n")
if len(sys.argv) > 1:
    fig.savefig(sys.argv[1], dpi=150, facecolor="white")
