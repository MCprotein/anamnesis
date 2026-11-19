import * as fs from "node:fs";
import * as path from "node:path";
import {
	type ParallelBenchmarkOptions,
	type ParallelBenchmarkResult,
	WORK_PARALLEL_AGENT_OUTPUT_DIR,
} from "./benchmark_work_parallel_agent_types.js";
import {
	assertNoSymlinkPath,
	errorMessage,
	isFileNotFoundError,
} from "./benchmark_work_parallel_agent_util.js";

export function renderParallelBenchmarkMarkdown(
	result: ParallelBenchmarkResult,
): string {
	const finalProtocol = result.protocol === "final";
	const familyRows = result.scenario_families
		.map((family) => {
			const summary = result.family_summaries[family];
			return `| ${family} | ${summary.pairs} | ${summary.disabled_final_accuracy_pct}% | ${summary.enabled_final_accuracy_pct}% | ${formatSignedNumber(summary.accuracy_delta_points)}pp | ${summary.review_audit_oracle_exact}/${summary.pairs} | ${summary.reviewer_exact}/${summary.pairs} | ${summary.final_exact}/${summary.pairs} |`;
		})
		.join("\n");
	return `# Harness-orchestrated parallel-agent Work A/B\n\n- Generated: ${result.generated_at}\n- Protocol: \`${result.protocol}\`${result.claim_eligible ? " (claim eligible)" : " (diagnostic only)"}\n- Model: \`${result.model}\` (reasoning effort: ${result.reasoning_effort})\n- Implementation: \`${result.implementation_git_sha}\`\n- Prior paid attempts: ${result.attempts_before_this_sha}\n- Scenarios: ${result.scenario_families.join(", ")}\n- Pairs: ${result.comparison.total_pairs}\n- Planned/actual invocations: ${result.planned_initial_invocations}/${result.actual_invocations}\n- Harness validity: **${result.harness_validity.ok ? "PASS" : "FAIL"}**\n- Diagnostic contract: **${result.evaluation.diagnostic_contract_pass ? "PASS" : "FAIL"}**\n- Product verdict: **${result.comparison.verdict}**\n- Enabled audit/reviewer/final quality gate: **${result.quality.enabled_ready ? "PASS" : "FAIL"}** (${result.quality.enabled_complete_passes}/${result.quality.total_per_condition})\n\n![Parallel-agent ${escapeMarkdownAlt(result.model)} benchmark](work-parallel-agent-ab-summary.svg)\n\n| Condition | Exact reviewed pipelines | Child accuracy | Reviewer accuracy | Final accuracy | Critical path/run | Tokens/run |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n| Work disabled | ${result.quality.disabled_passes}/${result.quality.total_per_condition} | ${result.summary.disabled.child_accuracy_pct}% | ${result.summary.disabled.reviewer_accuracy_pct}% | ${result.summary.disabled.final_accuracy_pct}% | ${result.summary.disabled.critical_path_ms} ms | ${result.summary.disabled.total_tokens} |\n| Work enabled | ${result.quality.enabled_passes}/${result.quality.total_per_condition} | ${result.summary.enabled.child_accuracy_pct}% | ${result.summary.enabled.reviewer_accuracy_pct}% | ${result.summary.enabled.final_accuracy_pct}% | ${result.summary.enabled.critical_path_ms} ms | ${result.summary.enabled.total_tokens} |\n\n| Scenario family | Pairs | Disabled accuracy | Enabled accuracy | Delta | Audit exact | Reviewer exact | Final exact |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${familyRows}\n\nEnabled won **${result.comparison.enabled_pair_wins}/${result.comparison.total_pairs}**, tied **${result.comparison.paired_ties}/${result.comparison.total_pairs}**, and lost **${result.comparison.enabled_pair_losses}/${result.comparison.total_pairs}**. Mean final-accuracy delta: **${formatSignedNumber(result.comparison.delta_points)}pp**; exact one-sided sign-test p-value: **${result.comparison.sign_test_p_value}**.\n\n| Preregistered gate | Result |\n| --- | --- |\n| Harness validity | ${result.harness_validity.ok ? "PASS" : "FAIL"} |\n| Accuracy and per-family floor | ${result.comparison.accuracy_gate ? "PASS" : "FAIL"} |\n| Absolute quality | ${result.comparison.critical_quality_gate ? "PASS" : "FAIL"} |\n| Tokens (aggregate ≤+5%, p50 ≤+5%, bootstrap upper ≤+10%) | ${result.comparison.cost_gate ? "PASS" : "FAIL"} — p50 ${formatSignedPercent(result.summary.paired.total_tokens_pct_p50)}, upper ${formatSignedPercent(result.summary.paired.total_tokens_pct_upper_90)} |\n| Critical path (p50 ≤+10%, bootstrap upper ≤+20%) | ${result.comparison.latency_gate ? "PASS" : "FAIL"} — p50 ${formatSignedPercent(result.summary.paired.critical_path_pct_p50)}, upper ${formatSignedPercent(result.summary.paired.critical_path_pct_upper_90)} |\n\n## Claim boundary\n\n${finalProtocol ? "This is the single held-out claim-eligible attempt for the recorded implementation commit. A pass means only that the preregistered three-scenario contract passed; it is not a general productivity or model-independent claim." : "Validate and shadow protocols are never claim eligible. Their verdict remains INCONCLUSIVE even when the separate diagnostic contract passes."} The harness launches separate Codex processes and proves child interval overlap; it does not measure same-session native subagent spawning. Audit digests and aggregate summaries are code-verified, but raw model answers are intentionally not published and therefore are not externally reconstructable from this artifact alone. All stage costs and failures are retained. No prompts, answers, stderr, PIDs, fixture bodies, or host paths are published.\n`;
}

export function addStageCostRows(
	markdown: string,
	result: Pick<ParallelBenchmarkResult, "summary" | "comparison">,
): string {
	const stageRows = `| Combined child tokens (p50 ≤0%, bootstrap upper ≤+5%) | p50 ${formatSignedPercent(result.summary.paired.combined_child_tokens_pct_p50)}, upper ${formatSignedPercent(result.summary.paired.combined_child_tokens_pct_upper_90)} |\n| Reviewer tokens (p50 ≤0%, bootstrap upper ≤+5%) | p50 ${formatSignedPercent(result.summary.paired.reviewer_tokens_pct_p50)}, upper ${formatSignedPercent(result.summary.paired.reviewer_tokens_pct_upper_90)} |\n| Stage token gate | ${result.comparison.stage_cost_gate ? "PASS" : "FAIL"} |`;
	return markdown
		.replace("\n| Critical path (", `\n${stageRows}\n| Critical path (`)
		.replace(
			"\n## Claim boundary",
			"\nAudit digests are opaque code-generated fingerprints; the public aggregate artifact does not contain enough raw data to recompute them independently.\n\n## Claim boundary",
		);
}

export function publishParallelArtifacts(
	result: Pick<
		ParallelBenchmarkResult,
		| "project_root"
		| "artifacts"
		| "markdown"
		| "model"
		| "runs_per_condition"
		| "summary"
		| "harness_validity"
		| "quality"
		| "comparison"
	>,
	outputPath = WORK_PARALLEL_AGENT_OUTPUT_DIR,
	operations = { renameSync: fs.renameSync, rmSync: fs.rmSync },
): ParallelBenchmarkResult["artifacts"] {
	const root = path.resolve(result.project_root);
	const outputDir = path.resolve(root, outputPath);
	if (outputDir === root || !outputDir.startsWith(`${root}${path.sep}`)) {
		throw new Error("benchmark output path escapes project root");
	}
	assertNoSymlinkPath(root, outputDir);
	fs.mkdirSync(outputDir, { recursive: true });
	assertNoSymlinkPath(root, outputDir);
	const outputIdentity = captureParallelArtifactDirectoryIdentity(outputDir);
	const jsonPath = path.join(outputDir, "work-parallel-agent-ab.json");
	const markdownPath = path.join(outputDir, "README.md");
	const summarySvgPath = path.join(
		outputDir,
		"work-parallel-agent-ab-summary.svg",
	);
	for (const artifactPath of [jsonPath, markdownPath, summarySvgPath]) {
		if (
			fs.existsSync(artifactPath) &&
			fs.lstatSync(artifactPath).isSymbolicLink()
		) {
			throw new Error("benchmark artifact must not be a symlink");
		}
	}
	const artifacts = {
		output_dir: path.relative(root, outputDir),
		json: path.relative(root, jsonPath),
		markdown: path.relative(root, markdownPath),
		summary_svg: path.relative(root, summarySvgPath),
	};
	const published = {
		...result,
		project_root: ".",
		artifacts,
		markdown: undefined,
	};
	assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
	const stagedDir = fs.mkdtempSync(
		path.join(outputDir, ".work-parallel-agent-publish-"),
	);
	const stagedIdentity = captureParallelArtifactDirectoryIdentity(stagedDir);
	const stagedJson = path.join(stagedDir, path.basename(jsonPath));
	const stagedMarkdown = path.join(stagedDir, path.basename(markdownPath));
	const stagedSvg = path.join(stagedDir, path.basename(summarySvgPath));
	let preserveStagedDir = false;
	try {
		assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
		assertParallelArtifactDirectoryIdentity(stagedDir, stagedIdentity);
		fs.writeFileSync(stagedJson, `${JSON.stringify(published, null, 2)}\n`, {
			flag: "wx",
		});
		assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
		assertParallelArtifactDirectoryIdentity(stagedDir, stagedIdentity);
		fs.writeFileSync(stagedMarkdown, result.markdown, { flag: "wx" });
		assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
		assertParallelArtifactDirectoryIdentity(stagedDir, stagedIdentity);
		fs.writeFileSync(stagedSvg, renderSummarySvg(result), { flag: "wx" });
		publishStagedParallelArtifacts(
			[
				{ staged: stagedMarkdown, destination: markdownPath },
				{ staged: stagedSvg, destination: summarySvgPath },
				// JSON is last because it is the machine-readable commit record.
				{ staged: stagedJson, destination: jsonPath },
			],
			outputDir,
			outputIdentity,
			stagedDir,
			stagedIdentity,
			operations,
		);
	} catch (error) {
		preserveStagedDir =
			error instanceof ParallelArtifactRollbackError ||
			error instanceof ParallelArtifactIdentityError;
		throw error;
	} finally {
		if (!preserveStagedDir) {
			assertParallelArtifactDirectoryIdentity(stagedDir, stagedIdentity);
			operations.rmSync(stagedDir, { recursive: true, force: true });
		}
	}
	return artifacts;
}

function renderSummarySvg(
	result: Pick<
		ParallelBenchmarkResult,
		| "model"
		| "runs_per_condition"
		| "summary"
		| "harness_validity"
		| "quality"
		| "comparison"
	>,
): string {
	const maxTokens = Math.max(
		result.summary.disabled.total_tokens,
		result.summary.enabled.total_tokens,
	);
	const disabledWidth = Math.round(
		maxTokens > 0
			? (340 * result.summary.disabled.total_tokens) / maxTokens
			: 0,
	);
	const enabledWidth = Math.round(
		maxTokens > 0 ? (340 * result.summary.enabled.total_tokens) / maxTokens : 0,
	);
	const disabledAccuracyWidth = Math.round(
		(340 * result.summary.disabled.final_accuracy_pct) / 100,
	);
	const enabledAccuracyWidth = Math.round(
		(340 * result.summary.enabled.final_accuracy_pct) / 100,
	);
	const model = escapeXml(result.model);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="348" viewBox="0 0 760 348" role="img" aria-labelledby="title desc">
  <title id="title">Parallel-agent ${model} Work A/B benchmark</title>
  <desc id="desc">Final requirement accuracy changed from ${result.summary.disabled.final_accuracy_pct} percent to ${result.summary.enabled.final_accuracy_pct} percent; product verdict ${result.comparison.verdict}.</desc>
	  <rect width="760" height="348" rx="16" fill="#0f172a"/>
  <text x="32" y="42" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="22" font-weight="700">Parallel-agent ${model} benchmark (${result.comparison.total_pairs} pairs)</text>
  <text x="32" y="72" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="14">Harness ${result.harness_validity.ok ? "PASS" : "FAIL"} · ${result.comparison.verdict} · enabled quality ${result.quality.enabled_ready ? "PASS" : "FAIL"}</text>
  <text x="32" y="112" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="16" font-weight="600">Average total tokens / pipeline</text>
  <text x="32" y="142" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="14">Disabled</text>
  <rect x="128" y="126" width="${disabledWidth}" height="22" rx="5" fill="#64748b"/>
  <text x="480" y="142" fill="#f8fafc" font-family="ui-monospace,monospace" font-size="14">${result.summary.disabled.total_tokens}</text>
  <text x="32" y="176" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="14">Enabled</text>
  <rect x="128" y="160" width="${enabledWidth}" height="22" rx="5" fill="#38bdf8"/>
  <text x="480" y="176" fill="#f8fafc" font-family="ui-monospace,monospace" font-size="14">${result.summary.enabled.total_tokens} (${formatSignedPercent(result.summary.delta.total_tokens_pct)})</text>
  <text x="32" y="222" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="16" font-weight="600">Final exact-requirement accuracy</text>
  <text x="32" y="252" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="14">Disabled</text>
  <rect x="128" y="236" width="${disabledAccuracyWidth}" height="22" rx="5" fill="#64748b"/>
  <text x="480" y="252" fill="#f8fafc" font-family="ui-monospace,monospace" font-size="14">${result.summary.disabled.final_accuracy_pct}%</text>
  <text x="32" y="286" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="14">Enabled</text>
  <rect x="128" y="270" width="${enabledAccuracyWidth}" height="22" rx="5" fill="#22c55e"/>
  <text x="480" y="286" fill="#f8fafc" font-family="ui-monospace,monospace" font-size="14">${result.summary.enabled.final_accuracy_pct}% (${formatSignedNumber(result.comparison.delta_points)}pp)</text>
	  <text x="32" y="316" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="12">Paired p50: total ${formatSignedPercent(result.summary.paired.total_tokens_pct_p50)} · children ${formatSignedPercent(result.summary.paired.combined_child_tokens_pct_p50)} · reviewer ${formatSignedPercent(result.summary.paired.reviewer_tokens_pct_p50)}</text>
	  <text x="32" y="334" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="12">Stage token gate ${result.comparison.stage_cost_gate ? "PASS" : "FAIL"} · critical path ${formatSignedPercent(result.summary.paired.critical_path_pct_p50)}</text>
</svg>\n`;
}

interface ParallelArtifactPathIdentity {
	exists: boolean;
	dev?: number;
	ino?: number;
}

interface ParallelArtifactDirectoryIdentity
	extends ParallelArtifactPathIdentity {
	realPath: string;
}

class ParallelArtifactRollbackError extends Error {}
class ParallelArtifactIdentityError extends Error {}

function publishStagedParallelArtifacts(
	artifacts: Array<{ staged: string; destination: string }>,
	outputDir: string,
	outputIdentity: ParallelArtifactDirectoryIdentity,
	stagedDir: string,
	stagedDirectoryIdentity: ParallelArtifactDirectoryIdentity,
	operations: NonNullable<ParallelBenchmarkOptions["artifactOperations"]>,
): void {
	assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
	const prepared = artifacts.map((artifact, index) => {
		assertParallelArtifactDirectoryIdentity(stagedDir, stagedDirectoryIdentity);
		const stagedIdentity = captureParallelArtifactFileIdentity(artifact.staged);
		const identity = captureParallelArtifactFileIdentity(artifact.destination);
		const backup = `${artifact.staged}.previous-${index}`;
		const candidate = `${artifact.staged}.candidate-${index}`;
		assertParallelArtifactFileIdentity(artifact.staged, stagedIdentity);
		fs.copyFileSync(artifact.staged, candidate);
		const candidateIdentity = captureParallelArtifactFileIdentity(candidate);
		let backupIdentity: ParallelArtifactPathIdentity | undefined;
		if (identity.exists) {
			assertParallelArtifactDirectoryIdentity(
				stagedDir,
				stagedDirectoryIdentity,
			);
			assertParallelArtifactFileIdentity(artifact.destination, identity);
			fs.copyFileSync(artifact.destination, backup);
			backupIdentity = captureParallelArtifactFileIdentity(backup);
		}
		return {
			...artifact,
			backup,
			backupIdentity,
			candidate,
			candidateIdentity,
			identity,
			stagedIdentity,
		};
	});
	const published: typeof prepared = [];
	try {
		for (const artifact of prepared) {
			assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
			assertParallelArtifactDirectoryIdentity(
				stagedDir,
				stagedDirectoryIdentity,
			);
			assertParallelArtifactFileIdentity(
				artifact.destination,
				artifact.identity,
			);
			assertParallelArtifactFileIdentity(
				artifact.candidate,
				artifact.candidateIdentity,
			);
			operations.renameSync(artifact.candidate, artifact.destination);
			published.push({ ...artifact, identity: artifact.candidateIdentity });
			assertParallelArtifactFileIdentity(
				artifact.destination,
				artifact.candidateIdentity,
			);
		}
	} catch (error) {
		const rollbackFailures: string[] = [];
		for (const artifact of published.reverse()) {
			try {
				assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
				assertParallelArtifactDirectoryIdentity(
					stagedDir,
					stagedDirectoryIdentity,
				);
				assertParallelArtifactFileIdentity(
					artifact.destination,
					artifact.identity,
				);
				if (artifact.backupIdentity) {
					assertParallelArtifactFileIdentity(
						artifact.backup,
						artifact.backupIdentity,
					);
					operations.renameSync(artifact.backup, artifact.destination);
				} else {
					operations.rmSync(artifact.destination, { force: true });
				}
			} catch (rollbackError) {
				rollbackFailures.push(
					`${artifact.destination}: ${errorMessage(rollbackError)}`,
				);
			}
		}
		if (rollbackFailures.length > 0) {
			throw new ParallelArtifactRollbackError(
				`artifact publish failed (${errorMessage(error)}) and rollback was incomplete; recovery files preserved in ${path.dirname(artifacts[0]!.staged)}: ${rollbackFailures.join("; ")}`,
			);
		}
		throw error;
	}
}

function captureParallelArtifactDirectoryIdentity(
	directory: string,
): ParallelArtifactDirectoryIdentity {
	const stat = fs.lstatSync(directory);
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(`artifact output is not a stable directory: ${directory}`);
	}
	return {
		exists: true,
		dev: stat.dev,
		ino: stat.ino,
		realPath: fs.realpathSync.native(directory),
	};
}

function assertParallelArtifactDirectoryIdentity(
	directory: string,
	expected: ParallelArtifactDirectoryIdentity,
): void {
	const actual = captureParallelArtifactDirectoryIdentity(directory);
	if (
		actual.dev !== expected.dev ||
		actual.ino !== expected.ino ||
		actual.realPath !== expected.realPath
	) {
		throw new ParallelArtifactIdentityError(
			`artifact output changed during publication: ${directory}`,
		);
	}
}

function captureParallelArtifactFileIdentity(
	file: string,
): ParallelArtifactPathIdentity {
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(file);
	} catch (error) {
		if (isFileNotFoundError(error)) return { exists: false };
		throw error;
	}
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error(`artifact destination is not a regular file: ${file}`);
	}
	return { exists: true, dev: stat.dev, ino: stat.ino };
}

function assertParallelArtifactFileIdentity(
	file: string,
	expected: ParallelArtifactPathIdentity,
): void {
	const actual = captureParallelArtifactFileIdentity(file);
	if (
		actual.exists !== expected.exists ||
		actual.dev !== expected.dev ||
		actual.ino !== expected.ino
	) {
		throw new ParallelArtifactIdentityError(
			`artifact destination changed during publication: ${file}`,
		);
	}
}

function formatSignedPercent(value: number): string {
	return `${value > 0 ? "+" : ""}${value}%`;
}

function formatSignedNumber(value: number): string {
	return `${value > 0 ? "+" : ""}${value}`;
}

function escapeXml(value: string): string {
	return value.replace(/[&<>"']/gu, (character) => {
		const entities: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&apos;",
		};
		return entities[character]!;
	});
}

function escapeMarkdownAlt(value: string): string {
	return value.replace(/[\\\[\]]/gu, "\\$&");
}
