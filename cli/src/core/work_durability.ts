export const WorkDurability = {
	durable: "durable",
	ephemeral: "ephemeral",
} as const;
export type WorkDurability =
	(typeof WorkDurability)[keyof typeof WorkDurability];

export interface WorkDurabilityOptions {
	durability?: WorkDurability;
}

export function syncsToDisk(durability: WorkDurability | undefined): boolean {
	return durability !== WorkDurability.ephemeral;
}
