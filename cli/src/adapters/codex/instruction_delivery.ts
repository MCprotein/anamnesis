import type { RenderAction } from "../../core/render.js";

/** Keep routing in startup context and the complete manual fallback on disk. */
export function compactInstructionDelivery(
	actions: RenderAction[],
): RenderAction[] {
	return actions.flatMap((action): RenderAction[] => {
		if (
			action.kind !== "region" ||
			!/^codex-(hook|skill|cmd)-/.test(action.regionId)
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
					.replace("the script below", "the referenced procedure"),
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
					"Read that file when this command, skill, or matching fallback is needed; preserve its invocation and continuation rules. Native hooks keep their registered execution path. Do not preload every procedure at startup.",
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
