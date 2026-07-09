export interface TuiOptions {
  color?: boolean;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  width?: number;
}

export type TuiTone =
  | "accent"
  | "muted"
  | "success"
  | "warning"
  | "danger"
  | "code";

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

export interface Tui {
  readonly color: boolean;
  title(title: string, subtitle?: string): string[];
  section(label: string): string[];
  commandRows(rows: CommandRow[]): string[];
  keyValues(rows: KeyValueRow[]): string[];
  note(message: string, tone?: TuiTone): string;
  command(command: string): string;
  style(value: string, tone: TuiTone | "bold"): string;
}

export function createTui(opts: TuiOptions = {}): Tui {
  const env = opts.env ?? process.env;
  const color = opts.color ?? shouldUseColor(env, opts.isTTY);
  const width = Math.max(40, opts.width ?? process.stdout.columns ?? 100);

  function style(value: string, tone: TuiTone | "bold"): string {
    if (!color) return value;
    return `${STYLES[tone]}${value}${RESET}`;
  }

  function command(value: string): string {
    return style(value, "code");
  }

  function title(main: string, subtitle?: string): string[] {
    const lines = [style(main, "bold")];
    if (subtitle) lines.push(style(subtitle, "muted"));
    return lines;
  }

  function section(label: string): string[] {
    return ["", style(label, "accent")];
  }

  function commandRows(rows: CommandRow[]): string[] {
    const max = Math.min(
      34,
      Math.max(...rows.map((row) => row.command.length), 0),
    );
    return rows.flatMap((row) => {
      const prefix = `  ${command(row.command.padEnd(max))}  `;
      return wrap(row.description, width - visibleLength(prefix)).map((line, i) =>
        i === 0 ? `${prefix}${line}` : `${" ".repeat(visibleLength(prefix))}${line}`,
      );
    });
  }

  function keyValues(rows: KeyValueRow[]): string[] {
    const max = Math.min(28, Math.max(...rows.map((row) => row.key.length), 0));
    return rows.map((row) => {
      const value = row.tone ? style(row.value, row.tone) : row.value;
      return `  ${style(row.key.padEnd(max), "muted")}  ${value}`;
    });
  }

  function note(message: string, tone: TuiTone = "muted"): string {
    return `  ${style(message, tone)}`;
  }

  return { color, title, section, commandRows, keyValues, note, command, style };
}

export function shouldUseColor(
  env: NodeJS.ProcessEnv = process.env,
  isTTY = process.stdout.isTTY === true,
): boolean {
  if (env.NO_COLOR !== undefined) return false;
  if (env.ANAMNESIS_NO_COLOR !== undefined) return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  if (env.ANAMNESIS_FORCE_COLOR !== undefined && env.ANAMNESIS_FORCE_COLOR !== "0") {
    return true;
  }
  if (env.TERM === "dumb") return false;
  return isTTY;
}

export function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function wrap(value: string, width: number): string[] {
  const usable = Math.max(24, width);
  if (value.length <= usable) return [value];
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length > usable) {
      lines.push(current);
      current = word;
    } else {
      current += ` ${word}`;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [value];
}
