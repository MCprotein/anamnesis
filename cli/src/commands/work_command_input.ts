import * as path from "node:path";
import {
	resolveWorkStateRoot,
	type WorkSourceEventInput,
} from "../core/work_storage.js";
import type {
	WorkCommandSourceSelection,
	WorkReadInput,
} from "./work_types.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function selectedSource(
	input: WorkReadInput & WorkCommandSourceSelection,
): {
	eventId: string;
	value: WorkSourceEventInput;
} {
	const selected = [input.source_file, input.source_stdin].filter(
		(value) => value !== undefined,
	);
	if (selected.length !== 1) {
		throw new Error("exactly one of source_file or source_stdin is required");
	}
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	const value = selected[0]!;
	if ("body" in value && !(value.body instanceof Buffer)) {
		throw new Error("raw Work source body must be a Buffer");
	}
	const source: WorkSourceEventInput = {
		stateRoot: state.state_root,
		eventId: value.event_id,
		capturedAt: value.captured_at,
		client: value.client,
		contentType: value.content_type,
		fidelity: value.fidelity,
		allocationStatus: value.allocation_status,
		body: Buffer.from(value.body),
		attachmentRefs: value.attachment_refs,
	};
	assertSafeId(source.eventId, "source event ID");
	return { eventId: source.eventId, value: source };
}

export interface WorkLocations {
	stateRoot: string;
	ledgerPath: string;
	projectionPath: string;
}

export function workLocations(input: WorkReadInput): WorkLocations {
	assertSafeId(input.work_id, "work ID");
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	const directory = path.join(state.state_root, "work-units", input.work_id);
	return {
		stateRoot: state.state_root,
		ledgerPath: path.join(directory, "ledger.jsonl"),
		projectionPath: path.join(directory, "projection.yaml"),
	};
}

export function assertSafeId(value: string, label: string): void {
	if (!SAFE_ID.test(value)) throw new Error(`invalid ${label}`);
}
