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

export const CHIP = {
	ok: { label: "OK", tone: "success" },
	warn: { label: "WARN", tone: "warning" },
	fail: { label: "FAIL", tone: "danger" },
	info: { label: "INFO", tone: "accent" },
	todo: { label: "TODO", tone: "bold" },
	work: { label: "WORK", tone: "accent" },
} as const satisfies Record<string, { label: string; tone: TuiTone | "bold" }>;
export type Chip = (typeof CHIP)[keyof typeof CHIP];
export const CHIP_WIDTH = 6;

export const LEVEL = {
	ready: { label: "Ready", symbol: "\u2713", ascii: "OK", tone: "success" },
	notice: { label: "Notice", symbol: "i", ascii: "i", tone: "accent" },
	attention: { label: "Attention", symbol: "!", ascii: "!", tone: "warning" },
	failed: { label: "Failed", symbol: "\u2717", ascii: "x", tone: "danger" },
} as const satisfies Record<
	string,
	{ label: string; symbol: string; ascii: string; tone: TuiTone }
>;
export type Level = (typeof LEVEL)[keyof typeof LEVEL];

const LEVEL_ORDER: readonly Level[] = [
	LEVEL.ready,
	LEVEL.notice,
	LEVEL.attention,
	LEVEL.failed,
];

export function worstLevel(levels: readonly Level[]): Level {
	return levels.reduce(
		(worst, level) =>
			LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(worst) ? level : worst,
		LEVEL.ready as Level,
	);
}

export interface TableColumn {
	right?: boolean;
	width?: number;
}

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
	heading(command: string, scope: string): string[];
	verdict(options: VerdictOptions): string[];
	section(label: string, count?: number | string): string[];
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
	chip(chip: Chip): string;
	level(level: Level, summary?: string): string[];
	table(rows: string[][], columns?: TableColumn[]): string[];
	command(command: string): string;
	style(value: string, tone: TuiTone | "bold"): string;
	wrap(value: string, width?: number): string[];
	truncate(value: string, width?: number): string;
}

export function createTui(opts: TuiOptions = {}): Tui {
	const env = opts.env ?? process.env;
	const color = opts.color ?? shouldUseColor(env, opts.isTTY);
	const unicode = opts.unicode ?? shouldUseUnicode(env);
	const width = Math.max(
		40,
		resolveWidth(opts.width, process.stdout.columns, env.COLUMNS),
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
	function heading(main: string, scope: string): string[] {
		return visibleLength(main) + 2 + visibleLength(scope) <= width
			? [`${style(main, "bold")}  ${style(scope, "muted")}`]
			: title(main, scope);
	}
	function verdict(options: VerdictOptions): string[] {
		const levels: Record<TuiVerdict, Level> = {
			ready: LEVEL.ready,
			info: LEVEL.notice,
			warning: LEVEL.attention,
			error: LEVEL.failed,
		};
		return headline(levels[options.tone], options.label, options.summary);
	}
	function level(value: Level, summary?: string): string[] {
		return headline(value, value.label, summary);
	}
	function headline(value: Level, label: string, summary?: string): string[] {
		const prefix = `${style(unicode ? value.symbol : value.ascii, value.tone)} ${style(label, "bold")}`;
		if (!summary) return [prefix];
		const separator = "  ";
		const available = width - visibleLength(prefix) - separator.length;
		return available >= 24 && visibleLength(summary) <= available
			? [`${prefix}${separator}${summary}`]
			: [prefix, ...indent(wrapText(summary, width - 2), 2)];
	}
	function chip(value: Chip): string {
		const inner = CHIP_WIDTH - 2;
		const left = Math.floor((inner - value.label.length) / 2);
		const text = `${" ".repeat(left)}${value.label}${" ".repeat(inner - left - value.label.length)}`;
		return `[${style(text, value.tone)}]`;
	}
	function table(rows: string[][], columns: TableColumn[] = []): string[] {
		if (rows.length === 0) return [];
		const count = Math.max(...rows.map((row) => row.length));
		const widths = Array.from({ length: count - 1 }, (_, index) =>
			Math.max(
				columns[index]?.width ?? 0,
				...rows.map((row) => visibleLength(row[index] ?? "")),
			),
		);
		const used = widths.filter((value) => value > 0);
		const fixed = used.reduce((total, value) => total + value + 2, 2);
		const bodyWidth = width - fixed;
		return rows.flatMap((row) => {
			const cells = widths
				.map((cellWidth, index) =>
					cellWidth === 0
						? undefined
						: columns[index]?.right
							? padStart(row[index] ?? "", cellWidth)
							: pad(row[index] ?? "", cellWidth),
				)
				.filter((cell): cell is string => cell !== undefined);
			const prefix = `  ${cells.join("  ")}`;
			const last = row.length === count ? (row[count - 1] ?? "") : "";
			if (!last) return [prefix.trimEnd()];
			if (bodyWidth < 16)
				return [prefix.trimEnd(), ...indent(wrapText(last, width - 4), 4)];
			return hang(`${prefix}  `, last, bodyWidth);
		});
	}
	function section(label: string, count?: number | string): string[] {
		return [
			"",
			`${style(label, "accent")}${count === undefined ? "" : `  ${style(String(count), "muted")}`}`,
		];
	}
	function commandRows(rows: CommandRow[]): string[] {
		if (rows.length === 0) return [];
		const max = Math.max(...rows.map((row) => visibleLength(row.command)));
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
			const plainBody = `${row.value}${row.summary ? `, ${row.summary}` : ""}`;
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
					(part) => `  ${style("|", tone)} ${part}`,
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
		heading,
		verdict,
		section,
		commandRows,
		keyValues,
		statusRows,
		panel,
		detail,
		note,
		chip,
		level,
		table,
		command,
		style,
		wrap: (value, target = width) => wrapText(value, target),
		truncate: (value, target = width) => truncateText(value, target),
	};
}

export function resolveWidth(
	explicit: number | undefined,
	columns: number | undefined,
	environment: string | undefined,
): number {
	const fromEnvironment = Number.parseInt(environment ?? "", 10);
	for (const candidate of [explicit, columns, fromEnvironment]) {
		if (candidate !== undefined && Number.isFinite(candidate) && candidate > 0)
			return candidate;
	}
	return 80;
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
	return graphemes(stripAnsi(value)).reduce(
		(total, cluster) => total + clusterWidth(cluster),
		0,
	);
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, {
	granularity: "grapheme",
});

function graphemes(value: string): string[] {
	return Array.from(GRAPHEME_SEGMENTER.segment(value), (part) => part.segment);
}

function clusterWidth(cluster: string): number {
	const first = cluster.codePointAt(0) ?? 0;
	const pictographic = /\p{Extended_Pictographic}/u.test(cluster);
	if (
		pictographic &&
		(/[\u200d\ufe0f]/u.test(cluster) || /\p{Emoji_Modifier}/u.test(cluster))
	)
		return 2;
	if (/[\ufe0f\u20e3]/u.test(cluster) && /\p{Emoji}/u.test(cluster)) return 2;
	if (/\p{Emoji_Presentation}/u.test(String.fromCodePoint(first))) return 2;
	return [...cluster].reduce(
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
	if (usable <= 3) return splitByWidth(stripAnsi(value), usable)[0] ?? "";
	return `${splitByWidth(stripAnsi(value), usable - 3)[0] ?? ""}...`;
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
function padStart(value: string, width: number): string {
	return `${" ".repeat(Math.max(0, width - visibleLength(value)))}${value}`;
}
function indent(lines: string[], spaces: number): string[] {
	return lines.map((line) => `${" ".repeat(spaces)}${line}`);
}
function splitByWidth(value: string, width: number): string[] {
	if (width <= 0) return [""];
	const chunks: string[] = [];
	let current = "";
	let currentWidth = 0;
	for (const character of graphemes(value)) {
		const characterSize = clusterWidth(character);
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
	if ((code >= 0x1160 && code <= 0x11ff) || (code >= 0xd7b0 && code <= 0xd7ff))
		return 0;
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

const AMBIGUOUS_WIDTH_RANGES: readonly (readonly [number, number])[] = [
	[0x00a1, 0x00a1], [0x00a4, 0x00a4], [0x00a7, 0x00a8], [0x00aa, 0x00aa],
	[0x00ad, 0x00ae], [0x00b0, 0x00b4], [0x00b6, 0x00ba], [0x00bc, 0x00bf],
	[0x00c6, 0x00c6], [0x00d0, 0x00d0], [0x00d7, 0x00d8], [0x00de, 0x00e1],
	[0x00e6, 0x00e6], [0x00e8, 0x00ea], [0x00ec, 0x00ed], [0x00f0, 0x00f0],
	[0x00f2, 0x00f3], [0x00f7, 0x00fa], [0x00fc, 0x00fc], [0x00fe, 0x00fe],
	[0x0391, 0x03a9], [0x03b1, 0x03c9], [0x0401, 0x0401], [0x0410, 0x044f],
	[0x0451, 0x0451], [0x2010, 0x2010], [0x2013, 0x2016], [0x2018, 0x2019],
	[0x201c, 0x201d], [0x2020, 0x2022], [0x2024, 0x2027], [0x2030, 0x2030],
	[0x2032, 0x2033], [0x2035, 0x2035], [0x203b, 0x203b], [0x203e, 0x203e],
	[0x2074, 0x2074], [0x207f, 0x207f], [0x2081, 0x2084], [0x20ac, 0x20ac],
	[0x2103, 0x2103], [0x2105, 0x2105], [0x2109, 0x2109], [0x2113, 0x2113],
	[0x2116, 0x2116], [0x2121, 0x2122], [0x2126, 0x2126], [0x212b, 0x212b],
	[0x2153, 0x2154], [0x215b, 0x215e], [0x2160, 0x216b], [0x2170, 0x2179],
	[0x2189, 0x2189], [0x2190, 0x2199], [0x21b8, 0x21b9], [0x21d2, 0x21d2],
	[0x21d4, 0x21d4], [0x21e7, 0x21e7], [0x2200, 0x2200], [0x2202, 0x2203],
	[0x2207, 0x2208], [0x220b, 0x220b], [0x220f, 0x220f], [0x2211, 0x2211],
	[0x2215, 0x2215], [0x221a, 0x221a], [0x221d, 0x2220], [0x2223, 0x2223],
	[0x2225, 0x2225], [0x2227, 0x222c], [0x222e, 0x222e], [0x2234, 0x2237],
	[0x223c, 0x223d], [0x2248, 0x2248], [0x224c, 0x224c], [0x2252, 0x2252],
	[0x2260, 0x2261], [0x2264, 0x2267], [0x226a, 0x226b], [0x226e, 0x226f],
	[0x2282, 0x2283], [0x2286, 0x2287], [0x2295, 0x2295], [0x2299, 0x2299],
	[0x22a5, 0x22a5], [0x22bf, 0x22bf], [0x2312, 0x2312], [0x2460, 0x24e9],
	[0x24eb, 0x254b], [0x2550, 0x2573], [0x2580, 0x258f], [0x2592, 0x2595],
	[0x25a0, 0x25a1], [0x25a3, 0x25a9], [0x25b2, 0x25b3], [0x25b6, 0x25b7],
	[0x25bc, 0x25bd], [0x25c0, 0x25c1], [0x25c6, 0x25c8], [0x25cb, 0x25cb],
	[0x25ce, 0x25d1], [0x25e2, 0x25e5], [0x25ef, 0x25ef], [0x2605, 0x2606],
	[0x2609, 0x2609], [0x260e, 0x260f], [0x261c, 0x261c], [0x261e, 0x261e],
	[0x2640, 0x2640], [0x2642, 0x2642], [0x2660, 0x2661], [0x2663, 0x2665],
	[0x2667, 0x266a], [0x266c, 0x266d], [0x266f, 0x266f], [0x269e, 0x269f],
	[0x26bf, 0x26bf], [0x26c6, 0x26cd], [0x26cf, 0x26d3], [0x26d5, 0x26e1],
	[0x26e3, 0x26e3], [0x26e8, 0x26e9], [0x26eb, 0x26f1], [0x26f4, 0x26f4],
	[0x26f6, 0x26f9], [0x26fb, 0x26fc], [0x26fe, 0x26ff], [0x273d, 0x273d],
	[0x2776, 0x277f], [0x2b56, 0x2b59], [0x3248, 0x324f], [0xe000, 0xf8ff],
	[0xfe00, 0xfe0f], [0xfffd, 0xfffd],
];

export function ambiguousWidthCharacters(value: string): string[] {
	return [...stripAnsi(value)].filter((character) => {
		const code = character.codePointAt(0) ?? 0;
		return AMBIGUOUS_WIDTH_RANGES.some(
			([start, end]) => code >= start && code <= end,
		);
	});
}
