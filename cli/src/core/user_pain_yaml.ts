import { parse as parseYaml, YAMLParseError } from "yaml";
import type { z } from "zod";

export class UserPainInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UserPainInputError";
	}
}

export function parseYamlSafely(source: string, label: string): unknown {
	try {
		return parseYaml(source);
	} catch (error) {
		const position =
			error instanceof YAMLParseError ? error.linePos?.[0] : undefined;
		throw new UserPainInputError(
			position
				? `${label}: invalid YAML at line ${position.line}, column ${position.col}`
				: `${label}: invalid YAML`,
		);
	}
}

export function describeSchemaIssues(error: z.ZodError, label: string): string {
	const issues = error.issues
		.slice(0, 5)
		.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"} (${issue.code})`);
	return `${label}: invalid entries: ${issues.join(", ")}`;
}
