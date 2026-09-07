import type { RenderAction } from "../../core/render.js";

/** Keep concise commands inline; disclose longer procedures on demand. */
export function compactInstructionDelivery(
	actions: RenderAction[],
): RenderAction[] {
	return actions.flatMap((action): RenderAction[] => {
		if (
			action.kind !== "region" ||
			!/^codex-(hook|skill|cmd)-/.test(action.regionId)
		)
			return [action];
		// A small command costs less inline than another file read on invocation.
		if (
			action.regionId.startsWith("codex-cmd-") &&
			Buffer.byteLength(action.content, "utf8") <= 2048
		)
			return [action];
		const source = `.anamnesis/codex-instructions/file-${encodeURIComponent(action.file)}/${encodeURIComponent(action.regionId)}.md`;
		const lines = action.content.split("\n");
		const routing = lines
			.filter(
				(line) =>
					line.startsWith("When the user ") ||
					line.startsWith("**When:**") ||
					line.startsWith("**Codex") ||
					line.startsWith("**Declared side effects:**") ||
					line.startsWith("**Intent:**"),
			)
			.map((line) =>
				line
					.replace("follow the steps below", "follow the referenced procedure")
					.replace("the script below", "the referenced procedure")
					.replace(
						"Codex agents should manually invoke or replicate the behavior when the corresponding situation arises (e.g., after editing a file matching the event).",
						"Use the manual fallback only when the corresponding native execution is unavailable.",
					),
			);
		return [
			{
				...action,
				content: [
					lines[0],
					"",
					...routing,
					"",
					`Full procedure and manual fallback (relative to project root): \`${source}\`.`,
					action.regionId.startsWith("codex-hook-")
						? "Read this manual only at its declared trigger when this specific handler lacks enabled native support, or when asked to inspect it. Enabled native handlers may succeed silently; absent output alone is not a fallback trigger. Another handler on the same event does not establish support for this one. Do not preload future-trigger manuals or replay enabled native handlers."
						: action.regionId.startsWith("codex-skill-")
							? "A routine startup check does not itself invoke this skill. Read its full procedure when the current task matches its purpose or relevant context is missing; preserve its invocation and continuation rules."
							: "When the user invokes this command, read the full procedure and preserve its standalone or auxiliary continuation rules. Do not preload it for unrelated tasks.",
				].join("\n"),
			},
			{
				kind: "file",
				path: source,
				fragmentId: action.fragmentId,
				fragmentVersion: action.fragmentVersion,
				sideEffects: action.sideEffects,
				content: action.content,
			},
		];
	});
}
