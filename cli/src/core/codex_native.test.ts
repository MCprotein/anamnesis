import { describe, expect, it } from "vitest";
import {
  codexHookRegistrationPresent,
  codexHooksFeatureEnabled,
  codexNativeNodeCommand,
  mergeCodexHookRegistration,
  upsertCodexHooksFeatureFlag,
} from "./codex_native.js";

const sessionStartReg = {
  event: "SessionStart",
  matcher: "startup|resume|clear",
  command: codexNativeNodeCommand(
    ".anamnesis/codex-native-hooks/session-start.mjs",
  ),
};

describe("Codex native hook config helpers", () => {
  it("enables codex_hooks in an existing [features] section", () => {
    const next = upsertCodexHooksFeatureFlag(
      "[features]\nchild_agents_md = true\n\n[env]\nFOO = \"bar\"\n",
    );

    expect(next).toContain("[features]\nchild_agents_md = true\ncodex_hooks = true");
    expect(next).toContain("[env]\nFOO = \"bar\"");
    expect(codexHooksFeatureEnabled(next)).toBe(true);
  });

  it("replaces a disabled codex_hooks flag", () => {
    const next = upsertCodexHooksFeatureFlag(
      "[features]\ncodex_hooks = false\n",
    );

    expect(next).toContain("codex_hooks = true");
    expect(next).not.toContain("codex_hooks = false");
  });

  it("adds a [features] section when absent", () => {
    const next = upsertCodexHooksFeatureFlag("[env]\nA = \"B\"\n");

    expect(next).toContain("[env]\nA = \"B\"\n\n[features]\ncodex_hooks = true");
    expect(codexHooksFeatureEnabled(next)).toBe(true);
  });

  it("merges SessionStart registration without dropping user hooks", () => {
    const merged = mergeCodexHookRegistration(
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: "startup|resume|clear",
              hooks: [
                {
                  type: "command",
                  command:
                    'node ".anamnesis/codex-native-hooks/session-start.mjs"',
                },
                { type: "command", command: "echo keep-me" },
              ],
            },
          ],
          Stop: [
            {
              hooks: [{ type: "command", command: "echo user-stop" }],
            },
          ],
        },
      }),
      sessionStartReg,
    );

    const parsed = JSON.parse(merged.content) as {
      hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const sessionStartCommands = parsed.hooks.SessionStart!.flatMap((entry) =>
      entry.hooks ?? [],
    ).map((hook) => hook.command);

    expect(sessionStartCommands).toContain("echo keep-me");
    expect(sessionStartCommands.filter((command) =>
      command === sessionStartReg.command
    )).toHaveLength(1);
    expect(JSON.stringify(parsed.hooks.Stop)).toContain("echo user-stop");
    expect(codexHookRegistrationPresent(merged.content, sessionStartReg)).toBe(
      true,
    );
  });

  it("starts from an empty hooks.json when no valid JSON exists", () => {
    const merged = mergeCodexHookRegistration("{ invalid", sessionStartReg);

    expect(codexHookRegistrationPresent(merged.content, sessionStartReg)).toBe(
      true,
    );
  });

  it("dedupes managed hooks even when the command wrapper shape changes", () => {
    const merged = mergeCodexHookRegistration(
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: "startup|resume|clear",
              hooks: [
                {
                  type: "command",
                  command:
                    'node ".anamnesis/codex-native-hooks/session-start.mjs"',
                },
              ],
            },
          ],
        },
      }),
      sessionStartReg,
    );

    const parsed = JSON.parse(merged.content) as {
      hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const commands = parsed.hooks.SessionStart!.flatMap((entry) =>
      entry.hooks ?? [],
    ).map((hook) => hook.command);

    expect(commands).toEqual([sessionStartReg.command]);
  });
});
