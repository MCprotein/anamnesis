export interface TuiOptions {
	color?: boolean;
	env?: NodeJS.ProcessEnv;
	isTTY?: boolean;
	unicode?: boolean;
	width?: number;
}

export type TuiTone =
	| "accent"
	| "muted"
	| "success"
	| "warning"
	| "danger"
	| "code";
export type TuiVerdict = "ready" | "info" | "warning" | "error";

const RESET = "\x1b[0m";
const STYLES: Record<TuiTone | "bold", string> = {
	accent: "\x1b[36m",
	muted: "\x1b[2m",
	success: "\x1b[32m",
	warning: "\x1b[33m",
	danger: "\x1b[31m",
	code: "\x1b[35m",
	bold: "\x1b[1m",
};

export interface CommandRow {
	command: string;
	description: string;
}
export interface KeyValueRow {
	key: string;
	value: string;
	tone?: TuiTone;
}
export interface VerdictOptions {
	label: string;
	summary?: string;
	tone: TuiVerdict;
}
export interface StatusRow {
	label: string;
	value: string;
	tone?: TuiTone;
	summary?: string;
	detail?: string | string[];
}
export interface StatusRowsOptions {
	detail?: boolean;
}
export interface PanelOptions {
	tone?: Exclude<TuiTone, "code">;
}
export interface DetailOptions {
	expanded?: boolean;
}

export interface Tui {
	readonly color: boolean;
	readonly unicode: boolean;
	readonly width: number;
	title(title: string, subtitle?: string): string[];
	verdict(options: VerdictOptions): string[];
	section(label: string, count?: number): string[];
	commandRows(rows: CommandRow[]): string[];
	keyValues(rows: KeyValueRow[]): string[];
	statusRows(rows: StatusRow[], options?: StatusRowsOptions): string[];
	panel(
		title: string,
		lines: string | string[],
		options?: PanelOptions,
	): string[];
	detail(
		label: string,
		lines: string | string[],
		options?: DetailOptions,
	): string[];
	note(message: string, tone?: TuiTone): string;
	command(command: string): string;
	style(value: string, tone: TuiTone | "bold"): string;
	wrap(value: string, width?: number): string[];
	truncate(value: string, width?: number): string;
}

export function createTui(opts: TuiOptions = {}): Tui {
	const env = opts.env ?? process.env;
	const color = opts.color ?? shouldUseColor(env, opts.isTTY);
	const unicode = opts.unicode ?? shouldUseUnicode(env);
	const environmentWidth = Number.parseInt(env.COLUMNS ?? "", 10);
	const width = Math.max(
		40,
		opts.width ??
			process.stdout.columns ??
			(Number.isFinite(environmentWidth) ? environmentWidth : 100),
	);

	function style(value: string, tone: TuiTone | "bold"): string {
		return color ? `${STYLES[tone]}${value}${RESET}` : value;
	}
	function command(value: string): string {
		return style(value, "code");
	}
	function title(main: string, subtitle?: string): string[] {
		return subtitle
			? [style(main, "bold"), style(subtitle, "muted")]
			: [style(main, "bold")];
	}
	function verdict(options: VerdictOptions): string[] {
		const semantics: Record<TuiVerdict, [string, string, TuiTone]> = {
			ready: ["●", "OK", "success"],
			info: ["●", "i", "accent"],
			warning: ["!", "!", "warning"],
			error: ["×", "x", "danger"],
		};
		const [symbol, fallback, tone] = semantics[options.tone];
		const prefix = `${style(unicode ? symbol : fallback, tone)} ${style(options.label, "bold")}`;
		if (!options.summary) return [prefix];
		const separator = ` ${style("—", "muted")} `;
		const available = width - visibleLength(prefix) - visibleLength(separator);
		return available >= 24 && visibleLength(options.summary) <= available
			? [`${prefix}${separator}${options.summary}`]
			: [prefix, ...indent(wrapText(options.summary, width - 2), 2)];
	}
	function section(label: string, count?: number): string[] {
		return [
			"",
			`${style(label, "accent")}${count === undefined ? "" : `  ${style(String(count), "muted")}`}`,
		];
	}
	function commandRows(rows: CommandRow[]): string[] {
		if (rows.length === 0) return [];
		const max = Math.max(
			...rows.map((row) => visibleLength(row.command)),
		);
    const bodyWidth = width - max - 4;
    if (bodyWidth < 24) {
      return rows.flatMap((row) => [
        ...wrapText(row.command, width - 2).map((line) => `  ${command(line)}`),
        ...indent(wrapText(row.description, width - 4), 4),
      ]);
		}
		return rows.flatMap((row) => {
			const prefix = `  ${command(pad(row.command, max))}  `;
			return hang(prefix, row.description, bodyWidth);
		});
	}
	function keyValues(rows: KeyValueRow[]): string[] {
		if (rows.length === 0) return [];
		const max = Math.min(
			28,
			Math.max(...rows.map((row) => visibleLength(row.key))),
		);
		return rows.flatMap((row) =>
			alignedRow(
				row.key,
				row.tone ? style(row.value, row.tone) : row.value,
				max,
			),
		);
	}
	function statusRows(
		rows: StatusRow[],
		options: StatusRowsOptions = {},
	): string[] {
		if (rows.length === 0) return [];
		const max = Math.min(
			24,
			Math.max(...rows.map((row) => visibleLength(row.label))),
		);
		return rows.flatMap((row) => {
			const plainBody = `${row.value}${row.summary ? ` · ${row.summary}` : ""}`;
			const body = row.tone ? style(plainBody, row.tone) : plainBody;
			const rendered = alignedRow(row.label, body, max);
			if (options.detail && row.detail) {
				const details = Array.isArray(row.detail) ? row.detail : [row.detail];
				rendered.push(
					...details.flatMap((line) =>
						indent(wrapText(style(line, "muted"), width - 4), 4),
					),
				);
			}
			return rendered;
		});
	}
	function alignedRow(label: string, body: string, max: number): string[] {
		const bodyWidth = width - max - 4;
		if (bodyWidth < 16) {
			return [
				`  ${style(label, "muted")}`,
				...indent(wrapText(body, width - 4), 4),
			];
		}
		const prefix = `  ${style(pad(label, max), "muted")}  `;
		return hang(prefix, body, bodyWidth);
	}
	function panel(
		label: string,
		lines: string | string[],
		options: PanelOptions = {},
	): string[] {
		const values = Array.isArray(lines) ? lines : [lines];
		const tone = options.tone ?? "accent";
		return [
			style(label, tone),
			...values.flatMap((line) =>
				wrapText(line, width - 4).map(
					(part) => `  ${style(unicode ? "│" : "|", tone)} ${part}`,
				),
			),
		];
	}
	function detail(
		label: string,
		lines: string | string[],
		options: DetailOptions = {},
	): string[] {
		const values = Array.isArray(lines) ? lines : [lines];
		if (!options.expanded)
			return [
				`  ${style(`${label}: ${values.length} ${values.length === 1 ? "detail" : "details"}`, "muted")}`,
			];
		return [
			`  ${style(label, "muted")}`,
			...values.flatMap((line) => indent(wrapText(line, width - 4), 4)),
		];
	}
	function note(message: string, tone: TuiTone = "muted"): string {
		return `  ${style(message, tone)}`;
	}

	return {
		color,
		unicode,
		width,
		title,
		verdict,
		section,
		commandRows,
		keyValues,
		statusRows,
		panel,
		detail,
		note,
		command,
		style,
		wrap: (value, target = width) => wrapText(value, target),
		truncate: (value, target = width) => truncateText(value, target),
	};
}

export function shouldUseColor(
	env: NodeJS.ProcessEnv = process.env,
	isTTY = process.stdout.isTTY === true,
): boolean {
	if (env.NO_COLOR !== undefined || env.ANAMNESIS_NO_COLOR !== undefined)
		return false;
	if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
	if (
		env.ANAMNESIS_FORCE_COLOR !== undefined &&
		env.ANAMNESIS_FORCE_COLOR !== "0"
	)
		return true;
	return env.TERM !== "dumb" && isTTY;
}

export function shouldUseUnicode(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (env.NO_UNICODE !== undefined) return false;
	if (env.ANAMNESIS_UNICODE === "0" || env.ANAMNESIS_UNICODE === "false")
		return false;
	if (env.ANAMNESIS_UNICODE === "1" || env.ANAMNESIS_UNICODE === "true")
		return true;
	if (env.TERM === "dumb") return false;
	const locale =
		`${env.LC_ALL ?? ""} ${env.LC_CTYPE ?? ""} ${env.LANG ?? ""}`.trim();
	return locale === "" || !/^(C|POSIX)(?:\s|$)/i.test(locale);
}

export function stripAnsi(value: string): string {
	return value.replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleLength(value: string): number {
	return [...stripAnsi(value)].reduce(
		(total, character) => total + characterWidth(character),
		0,
	);
}

export function wrapText(value: string, width: number): string[] {
  const usable = Math.max(1, Math.floor(width));
  if (visibleLength(value) <= usable) return [value];
  const outerStyle = value.match(/^(\x1b\[[0-9;]*m)([\s\S]*)\x1b\[0m$/);
  if (outerStyle && !outerStyle[2]!.includes("\x1b[")) {
    return wrapText(outerStyle[2]!, usable).map(
      (line) => `${outerStyle[1]}${line}${RESET}`,
    );
  }
  // Mixed nested styles are stripped before wrapping so an escape sequence can
  // never be split into visible garbage. Reporters still encode state in text.
  const safeValue = value.includes("\x1b[") ? stripAnsi(value) : value;
  const words = safeValue.trim().split(/\s+/);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (visibleLength(word) > usable) {
			if (current) lines.push(current);
			const chunks = splitByWidth(word, usable);
			lines.push(...chunks.slice(0, -1));
			current = chunks.at(-1) ?? "";
		} else if (!current) current = word;
		else if (visibleLength(current) + visibleLength(word) + 1 > usable) {
			lines.push(current);
			current = word;
		} else current += ` ${word}`;
	}
	if (current) lines.push(current);
	return lines.length > 0 ? lines : [value];
}

export function truncateText(value: string, width: number): string {
	const usable = Math.max(1, Math.floor(width));
	if (visibleLength(value) <= usable) return value;
	return `${splitByWidth(stripAnsi(value), Math.max(0, usable - 1))[0] ?? ""}…`;
}

function hang(prefix: string, body: string, width: number): string[] {
	return wrapText(body, width).map((line, index) =>
		index === 0
			? `${prefix}${line}`
			: `${" ".repeat(visibleLength(prefix))}${line}`,
	);
}
function pad(value: string, width: number): string {
	return `${value}${" ".repeat(Math.max(0, width - visibleLength(value)))}`;
}
function indent(lines: string[], spaces: number): string[] {
	return lines.map((line) => `${" ".repeat(spaces)}${line}`);
}
function splitByWidth(value: string, width: number): string[] {
	if (width <= 0) return [""];
	const chunks: string[] = [];
	let current = "";
	let currentWidth = 0;
	for (const character of value) {
		const characterSize = characterWidth(character);
		if (current && currentWidth + characterSize > width) {
			chunks.push(current);
			current = "";
			currentWidth = 0;
		}
		current += character;
		currentWidth += characterSize;
	}
	if (current || chunks.length === 0) chunks.push(current);
	return chunks;
}
function characterWidth(character: string): number {
	const code = character.codePointAt(0) ?? 0;
	if (/\p{Mark}/u.test(character)) return 0;
	if (
		code >= 0x1100 &&
		(code <= 0x115f ||
			(code >= 0x2e80 && code <= 0xa4cf) ||
			(code >= 0xac00 && code <= 0xd7a3) ||
			(code >= 0xf900 && code <= 0xfaff) ||
			(code >= 0xff00 && code <= 0xff60) ||
			(code >= 0x1f300 && code <= 0x1faff))
	)
		return 2;
	return 1;
}
