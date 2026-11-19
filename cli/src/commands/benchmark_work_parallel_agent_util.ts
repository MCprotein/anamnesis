import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export function isObjectRecord(
	value: unknown,
): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isOneOf(value: unknown, allowed: string[]): value is string {
	return typeof value === "string" && allowed.includes(value);
}

export function assertNoSymlinkPath(root: string, destination: string): void {
	let current = destination;
	while (current !== root) {
		if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
			throw new Error("benchmark output directory must not traverse a symlink");
		}
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
}

export function isFileNotFoundError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

export function isFileExistsError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "EEXIST"
	);
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
