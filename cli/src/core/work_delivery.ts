export interface DeliverWorkBriefingInput {
	rendered: string;
	direct_tty: boolean;
	structured: boolean;
	write(value: string): Promise<void>;
	confirm(): void | Promise<void>;
}

export interface DeliverWorkBriefingResult {
	confirmed: boolean;
}

/**
 * A presentation boundary: prepare is already durable before this runs, and
 * confirmation happens only after the complete human briefing write resolves.
 */
export async function deliverWorkBriefing(
	input: DeliverWorkBriefingInput,
): Promise<DeliverWorkBriefingResult> {
	await input.write(input.rendered);
	if (!input.direct_tty || input.structured) return { confirmed: false };
	await input.confirm();
	await input.write("Delivery: confirmed in this terminal\n");
	return { confirmed: true };
}
