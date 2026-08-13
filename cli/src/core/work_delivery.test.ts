import { describe, expect, it, vi } from "vitest";
import { deliverWorkBriefing } from "./work_delivery.js";

describe("Work briefing delivery", () => {
	it("confirms only after a complete direct-TTY human write", async () => {
		const order: string[] = [];
		const result = await deliverWorkBriefing({
			rendered: "brief\n",
			direct_tty: true,
			structured: false,
			write: async (value) => {
				order.push(`write:${value.trim()}`);
			},
			confirm: () => {
				order.push("confirm");
			},
		});
		expect(result.confirmed).toBe(true);
		expect(order).toEqual([
			"write:brief",
			"confirm",
			"write:Delivery: confirmed in this terminal",
		]);
	});

	it("never confirms redirected/structured output or a failed write", async () => {
		const confirm = vi.fn();
		await expect(
			deliverWorkBriefing({
				rendered: "brief\n",
				direct_tty: true,
				structured: false,
				write: async () => {
					throw Object.assign(new Error("broken pipe"), { code: "EPIPE" });
				},
				confirm,
			}),
		).rejects.toMatchObject({ code: "EPIPE" });
		expect(confirm).not.toHaveBeenCalled();

		for (const input of [
			{ direct_tty: false, structured: false },
			{ direct_tty: true, structured: true },
		]) {
			const result = await deliverWorkBriefing({
				rendered: "brief\n",
				...input,
				write: async () => {},
				confirm,
			});
			expect(result.confirmed).toBe(false);
		}
		expect(confirm).not.toHaveBeenCalled();
	});
});
