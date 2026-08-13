import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "../util/hash.js";
import {
	deleteWorkCursor,
	readWorkCursor,
	type WorkCursor,
	workCursorPath,
	worktreeFingerprint,
	writeWorkCursorAtomic,
} from "./work_cursor.js";
import { resolveWorkStateRoot } from "./work_storage.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function temp(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-cursor-"));
	roots.push(root);
	return root;
}

function cursor(overrides: Partial<WorkCursor> = {}): WorkCursor {
	return {
		schema_version: "anamnesis.work-cursor.v1",
		cursor_id: "cur_test",
		client_session_ref: null,
		work_id: "wu_one",
		observed_revision: 1,
		last_event_id: "lev_1",
		projection_hash: sha256("projection-1"),
		worktree_fingerprint: sha256("tree-a"),
		updated_at: "2026-08-13T00:00:00.000Z",
		...overrides,
	};
}

describe("Work cursor", () => {
	it("survives three resume/update cycles and signals lag before refresh", () => {
		const root = temp();
		for (let revision = 1; revision <= 3; revision += 1) {
			const current = cursor({
				observed_revision: revision,
				last_event_id: `lev_${revision}`,
				projection_hash: sha256(`projection-${revision}`),
			});
			writeWorkCursorAtomic(root, current);
			expect(
				readWorkCursor(root, current.cursor_id, {
					work_id: current.work_id,
					revision,
					last_event_id: current.last_event_id,
					projection_hash: current.projection_hash,
				}),
			).toMatchObject({ status: "current", reload_required: false });

			expect(
				readWorkCursor(root, current.cursor_id, {
					work_id: current.work_id,
					revision: revision + 1,
					last_event_id: `lev_${revision + 1}`,
					projection_hash: sha256(`projection-${revision + 1}`),
				}),
			).toMatchObject({ status: "lagging", reload_required: true });
		}
	});

	it("treats deletion and corruption as reload signals without touching Work truth", () => {
		const root = temp();
		const workTruth = path.join(root, "work-units", "wu_one", "ledger.jsonl");
		fs.mkdirSync(path.dirname(workTruth), { recursive: true });
		fs.writeFileSync(workTruth, "committed\n");
		writeWorkCursorAtomic(root, cursor());

		fs.writeFileSync(workCursorPath(root, "cur_test"), "not: [valid");
		expect(readWorkCursor(root, "cur_test")).toMatchObject({
			status: "corrupt",
			reload_required: true,
		});
		expect(fs.readFileSync(workTruth, "utf8")).toBe("committed\n");

		expect(deleteWorkCursor(root, "cur_test")).toBe(true);
		expect(readWorkCursor(root, "cur_test")).toEqual({
			status: "missing",
			cursor: null,
			reload_required: true,
		});
		expect(fs.readFileSync(workTruth, "utf8")).toBe("committed\n");
	});

	it("signals a cursor switch and keeps separate sessions independent", () => {
		const root = temp();
		writeWorkCursorAtomic(
			root,
			cursor({ cursor_id: "cur_a", work_id: "wu_one" }),
		);
		writeWorkCursorAtomic(
			root,
			cursor({ cursor_id: "cur_b", work_id: "wu_two" }),
		);
		expect(
			readWorkCursor(root, "cur_a", {
				work_id: "wu_two",
				revision: 1,
				last_event_id: "lev_1",
				projection_hash: sha256("projection-1"),
			}),
		).toMatchObject({ status: "switched", reload_required: true });
		expect(readWorkCursor(root, "cur_b")).toMatchObject({
			status: "current",
			cursor: { work_id: "wu_two" },
		});
	});

	it("reloads on a cursor revision ahead of current Work truth", () => {
		const root = temp();
		const ahead = cursor({ observed_revision: 9 });
		writeWorkCursorAtomic(root, ahead);
		expect(
			readWorkCursor(root, ahead.cursor_id, {
				work_id: ahead.work_id,
				revision: 1,
				last_event_id: ahead.last_event_id,
				projection_hash: ahead.projection_hash,
			}),
		).toMatchObject({ status: "lagging", reload_required: true });
	});

	it("rejects cursor directory and final-path symlinks", () => {
		const root = temp();
		const elsewhere = temp();
		fs.symlinkSync(elsewhere, path.join(root, "work-cursors"), "dir");
		expect(() => writeWorkCursorAtomic(root, cursor())).toThrow(
			/symbolic link/,
		);

		fs.unlinkSync(path.join(root, "work-cursors"));
		fs.mkdirSync(path.join(root, "work-cursors"));
		fs.symlinkSync(
			path.join(elsewhere, "escaped.yaml"),
			workCursorPath(root, "cur_test"),
		);
		expect(() => writeWorkCursorAtomic(root, cursor())).toThrow(
			/symbolic link/,
		);
	});

	it("shares Work truth but gives a linked worktree a distinct stable fingerprint", () => {
		const checkout = temp();
		const linked = path.join(temp(), "linked");
		execFileSync("git", ["init", "-q", checkout]);
		execFileSync("git", [
			"-C",
			checkout,
			"config",
			"user.email",
			"test@example.com",
		]);
		execFileSync("git", ["-C", checkout, "config", "user.name", "Test"]);
		fs.writeFileSync(path.join(checkout, "README.md"), "test\n");
		execFileSync("git", ["-C", checkout, "add", "README.md"]);
		execFileSync("git", ["-C", checkout, "commit", "-qm", "initial"]);
		execFileSync("git", [
			"-C",
			checkout,
			"worktree",
			"add",
			"-q",
			"-b",
			"linked",
			linked,
		]);

		const primary = resolveWorkStateRoot(checkout);
		const secondary = resolveWorkStateRoot(linked);
		expect(secondary.state_root).toBe(primary.state_root);
		expect(worktreeFingerprint(checkout)).toBe(primary.worktree_fingerprint);
		expect(worktreeFingerprint(linked)).toBe(secondary.worktree_fingerprint);
		expect(secondary.worktree_fingerprint).not.toBe(
			primary.worktree_fingerprint,
		);
	});

	it("publishes by file fsync, rename, then directory fsync", () => {
		const root = temp();
		const calls: string[] = [];
		const io = {
			openSync: ((file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
				calls.push(flags === "r" ? "open-dir" : "open-temp");
				return fs.openSync(file, flags, mode);
			}) as typeof fs.openSync,
			writeFileSync: ((
				file: number,
				data: string,
				encoding: BufferEncoding,
			) => {
				calls.push("write");
				fs.writeFileSync(file, data, encoding);
			}) as typeof fs.writeFileSync,
			fsyncSync: ((fd: number) => {
				calls.push(calls.includes("rename") ? "fsync-dir" : "fsync-file");
				fs.fsyncSync(fd);
			}) as typeof fs.fsyncSync,
			closeSync: fs.closeSync,
			renameSync: ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
				calls.push("rename");
				fs.renameSync(oldPath, newPath);
			}) as typeof fs.renameSync,
			mkdirSync: fs.mkdirSync,
		};
		writeWorkCursorAtomic(root, cursor(), io);
		expect(calls).toEqual([
			"open-temp",
			"write",
			"fsync-file",
			"rename",
			"open-dir",
			"fsync-dir",
		]);
		expect(fs.statSync(workCursorPath(root, "cur_test")).mode & 0o777).toBe(
			0o600,
		);
	});
});
