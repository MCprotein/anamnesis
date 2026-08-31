import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexNativeNodeCommand } from "./codex_native.js";
import { sha256 } from "../util/hash.js";
import {
  analyzeCodexHookTrust,
	codexHookTrustApprovalOutcome,
  CodexHookTrustChangedError,
  CodexStdioAppServerTransport,
  inspectCodexHookTrust,
  trustCodexHooks,
  type CodexAppServerTransport,
  type CodexCommandHookMetadata,
  type CodexConfigBatchWriteParams,
  type CodexConfigReadResponse,
  type CodexHooksListResponse,
} from "./codex_hook_trust.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function project(commands?: Array<{
  event?: string;
  matcher?: string;
  command: string;
}>): { root: string; hooksPath: string; commands: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-hook-trust-"));
  tempDirs.push(root);
  const hooksPath = path.join(root, ".codex/hooks.json");
  const registrations = commands ?? [
    {
      event: "SessionStart",
      matcher: "startup|resume",
      command: codexNativeNodeCommand(
        ".anamnesis/codex-native-hooks/session-start.mjs",
      ),
    },
  ];
  const hooks: Record<string, unknown[]> = {};
  for (const registration of registrations) {
    const event = registration.event ?? "SessionStart";
    (hooks[event] ??= []).push({
      ...(registration.matcher ? { matcher: registration.matcher } : {}),
      hooks: [{ type: "command", command: registration.command }],
    });
  }
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, JSON.stringify({ hooks }, null, 2));
  const managedPaths = registrations.flatMap((registration) => {
    const match = registration.command.replace(/\\/g, "/").match(
      /(\.anamnesis\/codex-native-hooks\/[^"'\s;]+)/,
    );
    return match?.[1] ? [match[1]] : [];
  });
  const managedContent = "// managed test wrapper\n";
  for (const managedPath of managedPaths) {
    const absolute = path.join(root, managedPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, managedContent);
  }
  fs.mkdirSync(path.join(root, ".anamnesis"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".anamnesis/manifest.json"),
    JSON.stringify({
      version: 1,
      regions: [],
      files: managedPaths.map((managedPath) => ({
        path: managedPath,
        fragment_id: "base",
        fragment_version: 1,
        last_applied_hash: sha256(managedContent),
        current_user_hash: sha256(managedContent),
      })),
    }),
  );
  return {
    root,
    hooksPath,
    commands: registrations.map((registration) => registration.command),
  };
}

function runtimeHook(
  hooksPath: string,
  command: string,
  overrides: Partial<CodexCommandHookMetadata> = {},
): CodexCommandHookMetadata {
  return {
    key: "project:test:session-start",
    eventName: "sessionStart",
    matcher: "startup|resume",
    sourcePath: hooksPath,
    source: "project",
    pluginId: null,
    enabled: true,
    isManaged: false,
    currentHash: "sha256:current",
    trustStatus: "untrusted",
    handlerType: "command",
    command,
    ...overrides,
  };
}

function response(
  root: string,
  hooks: CodexCommandHookMetadata[],
): CodexHooksListResponse {
  return { data: [{ cwd: root, hooks, warnings: [], errors: [] }] };
}

class FakeTransport implements CodexAppServerTransport {
  readonly writes: CodexConfigBatchWriteParams[] = [];
  readonly reads: string[] = [];
  constructor(
    private readonly responses: Array<CodexHooksListResponse | Error>,
    private readonly config: CodexConfigReadResponse = {
      layers: [
        {
          name: { type: "user", profile: null },
          version: "user-v7",
          config: {},
          disabledReason: null,
        },
      ],
    },
    private readonly onList?: (call: number) => void,
  ) {}

  private listCalls = 0;

  async listHooks(): Promise<CodexHooksListResponse> {
    this.listCalls += 1;
    this.onList?.(this.listCalls);
    const value = this.responses.shift();
    if (!value) throw new Error("unexpected hooks/list");
    if (value instanceof Error) throw value;
    return structuredClone(value);
  }

  async readConfig(cwd: string): Promise<CodexConfigReadResponse> {
    this.reads.push(cwd);
    return structuredClone(this.config);
  }

  async batchWrite(params: CodexConfigBatchWriteParams): Promise<unknown> {
    this.writes.push(structuredClone(params));
    return { status: "ok", version: "user-v8" };
  }
}

describe("Codex hook trust analysis", () => {
  it("distinguishes trusted, untrusted, modified, and managed Anamnesis hooks", () => {
    const commands = ["trusted", "untrusted", "modified", "managed"].map(
      (name) => codexNativeNodeCommand(`.anamnesis/codex-native-hooks/${name}.mjs`),
    );
    const fixture = project(
      commands.map((command) => ({ command, matcher: "startup|resume" })),
    );
    const ownership = JSON.parse(fs.readFileSync(fixture.hooksPath, "utf8"));
    const report = analyzeCodexHookTrust({
      projectRoot: fixture.root,
      ownership: ownershipReport(fixture.root),
      response: response(fixture.root, [
        runtimeHook(fixture.hooksPath, commands[0]!, {
          key: "key-trusted",
          trustStatus: "trusted",
        }),
        runtimeHook(fixture.hooksPath, commands[1]!, {
          key: "key-untrusted",
          trustStatus: "untrusted",
        }),
        runtimeHook(fixture.hooksPath, commands[2]!, {
          key: "key-modified",
          trustStatus: "modified",
        }),
        runtimeHook(fixture.hooksPath, commands[3]!, {
          key: "key-managed",
          trustStatus: "untrusted",
          isManaged: true,
        }),
      ]),
    });

    expect(ownership.hooks).toBeDefined();
    expect(report.hooks.map((hook) => hook.status)).toEqual([
      "trusted",
      "untrusted",
      "modified",
      "managed",
    ]);
    expect(report.summary).toMatchObject({
      registered: 4,
      discovered: 4,
      trusted: 1,
      untrusted: 1,
      modified: 1,
      managed: 1,
      unknown: 0,
    });
  });

  it("keeps project-specific keys distinct for the same generated script", () => {
    const command = codexNativeNodeCommand(
      ".anamnesis/codex-native-hooks/session-start.mjs",
    );
    const first = project([{ command, matcher: "startup|resume" }]);
    const second = project([{ command, matcher: "startup|resume" }]);
    const firstReport = analyzeCodexHookTrust({
      projectRoot: first.root,
      ownership: ownershipReport(first.root),
      response: response(first.root, [
        runtimeHook(first.hooksPath, command, { key: "project-one:key" }),
      ]),
    });
    const secondReport = analyzeCodexHookTrust({
      projectRoot: second.root,
      ownership: ownershipReport(second.root),
      response: response(second.root, [
        runtimeHook(second.hooksPath, command, { key: "project-two:key" }),
      ]),
    });

    expect(firstReport.hooks[0]?.key).toBe("project-one:key");
    expect(secondReport.hooks[0]?.key).toBe("project-two:key");
  });

  it("filters user and OMX hooks even when Codex returns them beside Anamnesis hooks", () => {
    const anamnesis = codexNativeNodeCommand(
      ".anamnesis/codex-native-hooks/session-start.mjs",
    );
    const fixture = project([
      { command: anamnesis, matcher: "startup|resume" },
      { command: "echo user", matcher: "startup|resume" },
      {
        command: "node /tmp/oh-my-codex/codex-native-hook.js",
        matcher: "startup|resume",
      },
    ]);
    const report = analyzeCodexHookTrust({
      projectRoot: fixture.root,
      ownership: ownershipReport(fixture.root),
      response: response(fixture.root, [
        runtimeHook(fixture.hooksPath, anamnesis),
        runtimeHook(fixture.hooksPath, "echo user", { key: "user:key" }),
        runtimeHook(fixture.hooksPath, "node /tmp/oh-my-codex/codex-native-hook.js", {
          key: "omx:key",
        }),
      ]),
    });

    expect(report.hooks).toHaveLength(1);
    expect(report.hooks[0]?.command).toBe(anamnesis);
  });

  it("diagnoses a linked worktree source without synthesizing a local key", async () => {
    const fixture = project();
    const mainHooksPath = path.join(path.dirname(fixture.root), "main", ".codex/hooks.json");
    const transport = new FakeTransport([
      response(fixture.root, [
        runtimeHook(mainHooksPath, fixture.commands[0]!, {
          key: "main-worktree:key",
          trustStatus: "trusted",
        }),
      ]),
    ]);

    const result = await trustCodexHooks(fixture.root, {
      apply: true,
      transport,
    });

    expect(result.inspection.hooks[0]).toMatchObject({
      status: "unknown",
      runtimeDiscovered: false,
    });
    expect(result.inspection.hooks[0]?.key).toBeUndefined();
    expect(result.inspection.alternateProjectSources[0]?.sourcePath).toBe(
      mainHooksPath,
    );
    expect(result.inspection.warnings.join(" ")).toContain("another worktree");
		expect(codexHookTrustApprovalOutcome(result)).toBe("incomplete");
    expect(transport.writes).toHaveLength(0);
  });
});

describe("explicit Codex hook trust", () => {
  it("keeps dry-run read-only", async () => {
    const fixture = project();
    const listed = response(fixture.root, [
      runtimeHook(fixture.hooksPath, fixture.commands[0]!),
    ]);
    const transport = new FakeTransport([listed]);

    const result = await trustCodexHooks(fixture.root, {
      apply: false,
      transport,
    });

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({
      key: "project:test:session-start",
      currentHash: "sha256:current",
      status: "untrusted",
    });
    expect(transport.reads).toHaveLength(0);
    expect(transport.writes).toHaveLength(0);
  });

  it("upserts only reviewed keys with the current user config version", async () => {
    const commands = ["untrusted", "modified", "trusted"].map((name) =>
      codexNativeNodeCommand(`.anamnesis/codex-native-hooks/${name}.mjs`)
    );
    const fixture = project(
      commands.map((command) => ({ command, matcher: "startup|resume" })),
    );
    const initialHooks = [
      runtimeHook(fixture.hooksPath, commands[0]!, {
        key: "key-untrusted",
        currentHash: "sha256:u",
      }),
      runtimeHook(fixture.hooksPath, commands[1]!, {
        key: "key-modified",
        currentHash: "sha256:m",
        trustStatus: "modified",
      }),
      runtimeHook(fixture.hooksPath, commands[2]!, {
        key: "key-trusted",
        currentHash: "sha256:t",
        trustStatus: "trusted",
      }),
    ];
    const verifiedHooks = initialHooks.map((hook) =>
      hook.key === "key-trusted" ? hook : { ...hook, trustStatus: "trusted" as const }
    );
    const transport = new FakeTransport([
      response(fixture.root, initialHooks),
      response(fixture.root, initialHooks),
      response(fixture.root, verifiedHooks),
    ]);

    const result = await trustCodexHooks(fixture.root, {
      apply: true,
      transport,
    });

    expect(result.written.map((target) => target.key)).toEqual([
      "key-untrusted",
      "key-modified",
    ]);
    expect(transport.writes).toEqual([
      {
        edits: [
          {
            keyPath: "hooks.state",
            value: {
              "key-untrusted": { trusted_hash: "sha256:u" },
              "key-modified": { trusted_hash: "sha256:m" },
            },
            mergeStrategy: "upsert",
          },
        ],
        expectedVersion: "user-v7",
        reloadUserConfig: true,
      },
    ]);
    expect(transport.writes[0]?.edits[0]?.value).not.toHaveProperty("key-trusted");
  });

  it("aborts before write if a reviewed hash changes", async () => {
    const fixture = project();
    const first = runtimeHook(fixture.hooksPath, fixture.commands[0]!);
    const changed = { ...first, currentHash: "sha256:changed" };
    const transport = new FakeTransport([
      response(fixture.root, [first]),
      response(fixture.root, [changed]),
    ]);

    await expect(
      trustCodexHooks(fixture.root, { apply: true, transport }),
    ).rejects.toBeInstanceOf(CodexHookTrustChangedError);
    expect(transport.reads).toHaveLength(1);
    expect(transport.writes).toHaveLength(0);
  });

  it("fails safe when hooks/list is unsupported", async () => {
    const fixture = project();
    const transport = new FakeTransport([new Error("method not found")]);

    const inspection = await inspectCodexHookTrust(fixture.root, { transport });

    expect(inspection.available).toBe(false);
    expect(inspection.summary).toMatchObject({ registered: 1, unknown: 1 });
    expect(inspection.error).toContain("method not found");
    expect(transport.writes).toHaveLength(0);
  });

  it("does not authorize a substring-spoofed command absent from the manifest", async () => {
    const spoof = codexNativeNodeCommand(
      ".anamnesis/codex-native-hooks/spoofed.mjs",
    );
    const fixture = project([{ command: spoof, matcher: "startup|resume" }]);
    const manifestPath = path.join(fixture.root, ".anamnesis/manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      files: unknown[];
    };
    manifest.files = [];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const listed = response(fixture.root, [
      runtimeHook(fixture.hooksPath, spoof, { key: "spoof:key" }),
    ]);
    const transport = new FakeTransport([listed]);

    const result = await trustCodexHooks(fixture.root, {
      apply: true,
      transport,
    });

    expect(result.inspection.hooks[0]).toMatchObject({
      runtimeDiscovered: true,
      authorizedForTrust: false,
    });
    expect(result.targets).toHaveLength(0);
    expect(transport.writes).toHaveLength(0);
  });

  it("rejects extra shell payload around a tracked canonical wrapper command", async () => {
    const canonical = codexNativeNodeCommand(
      ".anamnesis/codex-native-hooks/session-start.mjs",
    );
    const injected = `${canonical}; echo injected`;
    const fixture = project([{ command: injected, matcher: "startup|resume" }]);
    const manifestPath = path.join(fixture.root, ".anamnesis/manifest.json");
    const wrapperPath = ".anamnesis/codex-native-hooks/session-start.mjs";
    const wrapperContent = "// managed test wrapper\n";
    fs.mkdirSync(path.join(fixture.root, ".anamnesis/codex-native-hooks"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(fixture.root, wrapperPath), wrapperContent);
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 1,
        regions: [],
        files: [
          {
            path: wrapperPath,
            fragment_id: "base",
            fragment_version: 1,
            last_applied_hash: sha256(wrapperContent),
            current_user_hash: sha256(wrapperContent),
          },
        ],
      }),
    );
    const listed = response(fixture.root, [
      runtimeHook(fixture.hooksPath, injected, { key: "injected:key" }),
    ]);
    const transport = new FakeTransport([listed]);

    const result = await trustCodexHooks(fixture.root, {
      apply: true,
      transport,
    });

    expect(result.targets).toHaveLength(0);
    expect(result.inspection.hooks[0]?.authorizedForTrust).toBe(false);
    expect(transport.writes).toHaveLength(0);
  });

  it("rejects a manifest-backed wrapper whose contents drifted", async () => {
    const fixture = project();
    fs.writeFileSync(
      path.join(fixture.root, ".anamnesis/codex-native-hooks/session-start.mjs"),
      "// user-modified wrapper\n",
    );
    const listed = response(fixture.root, [
      runtimeHook(fixture.hooksPath, fixture.commands[0]!),
    ]);
    const transport = new FakeTransport([listed]);

    const result = await trustCodexHooks(fixture.root, {
      apply: true,
      transport,
    });

    expect(result.targets).toHaveLength(0);
    expect(result.inspection.hooks[0]?.authorizedForTrust).toBe(false);
    expect(transport.writes).toHaveLength(0);
  });

  it("aborts if manifest ownership disappears before the pre-write re-list", async () => {
    const fixture = project();
    const listed = response(fixture.root, [
      runtimeHook(fixture.hooksPath, fixture.commands[0]!),
    ]);
    const transport = new FakeTransport(
      [listed, listed],
      undefined,
      (call) => {
        if (call === 2) {
          fs.writeFileSync(
            path.join(fixture.root, ".anamnesis/manifest.json"),
            JSON.stringify({ version: 1, regions: [], files: [] }),
          );
        }
      },
    );

    await expect(
      trustCodexHooks(fixture.root, { apply: true, transport }),
    ).rejects.toBeInstanceOf(CodexHookTrustChangedError);
    expect(transport.writes).toHaveLength(0);
  });
});

describe("Codex stdio transport", () => {
  it("turns malformed JSON into a bounded unavailable error", async () => {
    const transport = new CodexStdioAppServerTransport({
      command: process.execPath,
      args: [
        "-e",
        "process.stdin.once('data', () => process.stdout.write('not-json\\n'))",
      ],
      timeoutMs: 500,
    });
    await expect(transport.listHooks([process.cwd()])).rejects.toThrow(
      "malformed JSON",
    );
    await transport.close();
  });

  it("times out safely when app-server does not respond", async () => {
    const transport = new CodexStdioAppServerTransport({
      command: process.execPath,
      args: ["-e", "process.stdin.resume()"],
      timeoutMs: 30,
    });
    await expect(transport.listHooks([process.cwd()])).rejects.toThrow(
      "timed out",
    );
    await transport.close();
  });
});

function ownershipReport(root: string) {
  const content = fs.readFileSync(path.join(root, ".codex/hooks.json"), "utf8");
  // Use the same production ownership parser while keeping trust analysis pure.
  return requireOwnership(content, root);
}

function requireOwnership(content: string, projectRoot: string) {
  // Dynamic import is unnecessary here; this wrapper keeps fixture setup compact.
  const parsed = JSON.parse(content) as {
    hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
  };
  const entries = Object.entries(parsed.hooks).flatMap(([event, groups]) =>
    groups.flatMap((group, entryIndex) =>
      group.hooks.map((hook, hookIndex) => ({
        event,
        matcher: group.matcher,
        entryIndex,
        hookIndex,
        type: "command",
        command: hook.command,
        owner: hook.command.includes(".anamnesis/codex-native-hooks/")
          ? ("anamnesis" as const)
          : hook.command.includes("oh-my-codex")
            ? ("omx" as const)
            : ("user" as const),
      })),
    ),
  );
  return {
    readable: true,
    entries,
    warnings: [],
    summary: {
      total: entries.length,
      anamnesis: entries.filter((entry) => entry.owner === "anamnesis").length,
      omx: entries.filter((entry) => entry.owner === "omx").length,
      plugin: 0,
      user: entries.filter((entry) => entry.owner === "user").length,
      invalid: 0,
      duplicates: 0,
      warnings: 0,
    },
  };
}
