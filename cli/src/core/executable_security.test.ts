import { describe, expect, it } from "vitest";
import { analyzeExecutableSecurity } from "./executable_security.js";
import type { FileAction } from "./render.js";

function hookAction(over: Partial<FileAction> = {}): FileAction {
  return {
    kind: "file",
    path: ".claude/hooks/example.sh",
    fragmentId: "test",
    fragmentVersion: 1,
    content: "#!/usr/bin/env bash\nset -euo pipefail\necho hi\n",
    ...over,
  };
}

describe("analyzeExecutableSecurity — isExecutableAction boundary", () => {
  it("flags nothing for a non-executable file with no hook wiring", () => {
    const action: FileAction = {
      kind: "file",
      path: "docs/README.md",
      fragmentId: "test",
      fragmentVersion: 1,
      content: "rm -rf / # dangerous-looking but not executable",
    };
    const result = analyzeExecutableSecurity([action]);
    expect(result.ok).toBe(true);
    expect(result.summary.total).toBe(0);
  });

  it("treats a file with settingsHook as executable", () => {
    const action = hookAction({
      path: "some/other/path.sh",
      settingsHook: { event: "PostToolUse" },
      content: "echo missing safety",
    });
    const result = analyzeExecutableSecurity([action]);
    expect(result.issues.some((i) => i.code === "executable-shell-safety-missing")).toBe(true);
  });

  it("treats a file with codexHook as executable", () => {
    const action = hookAction({
      path: "some/other/path.sh",
      codexHook: { event: "PostToolUse", command: "run" },
      content: "echo missing safety",
    });
    const result = analyzeExecutableSecurity([action]);
    expect(result.issues.some((i) => i.code === "executable-shell-safety-missing")).toBe(true);
  });

  it("treats a file with executable mode bits as executable", () => {
    const action = hookAction({
      path: "some/other/path.sh",
      mode: 0o755,
      content: "echo missing safety",
    });
    const result = analyzeExecutableSecurity([action]);
    expect(result.issues.some((i) => i.code === "executable-shell-safety-missing")).toBe(true);
  });

  it("treats files under .anamnesis/codex-native-hooks/ and .git/hooks/ as executable", () => {
    const codexHook = hookAction({
      path: ".anamnesis/codex-native-hooks/session-start.sh",
      content: "#!/usr/bin/env bash\necho missing safety\n",
    });
    const gitHook = hookAction({
      path: ".git/hooks/pre-commit",
      content: "#!/usr/bin/env bash\necho missing safety\n",
    });
    const result = analyzeExecutableSecurity([codexHook, gitHook]);
    expect(result.summary.total).toBe(2);
  });

  it("ignores region actions entirely", () => {
    const result = analyzeExecutableSecurity([
      {
        kind: "region",
        file: "AGENTS.md",
        regionId: "test",
        fragmentId: "test",
        fragmentVersion: 1,
        content: "rm -rf / curl http://example.com",
      },
    ]);
    expect(result.ok).toBe(true);
    expect(result.summary.total).toBe(0);
  });
});

describe("analyzeExecutableSecurity — executable-shell-safety-missing", () => {
  it("does not warn when a bash script has set -euo pipefail", () => {
    const action = hookAction({
      content: "#!/usr/bin/env bash\nset -euo pipefail\necho ok\n",
    });
    const result = analyzeExecutableSecurity([action]);
    expect(result.issues.some((i) => i.code === "executable-shell-safety-missing")).toBe(false);
  });

  it("warns when a bash script omits set -euo pipefail", () => {
    const action = hookAction({
      content: "#!/usr/bin/env bash\necho ok\n",
    });
    const result = analyzeExecutableSecurity([action]);
    expect(result.issues.some((i) => i.code === "executable-shell-safety-missing")).toBe(true);
  });

  it("accepts set -eu for a sh shebang", () => {
    const action = hookAction({
      content: "#!/bin/sh\nset -eu\necho ok\n",
    });
    const result = analyzeExecutableSecurity([action]);
    expect(result.issues.some((i) => i.code === "executable-shell-safety-missing")).toBe(false);
  });

  it("warns for a sh script that only has set -euo pipefail (not portable) missing set -eu", () => {
    const action = hookAction({
      content: "#!/bin/sh\necho ok\n",
    });
    const result = analyzeExecutableSecurity([action]);
    expect(result.issues.some((i) => i.code === "executable-shell-safety-missing")).toBe(true);
  });

  it("requires set -euo pipefail by default for an unrecognized shebang", () => {
    const action = hookAction({
      content: "#!/usr/bin/env node\necho ok\n",
    });
    const result = analyzeExecutableSecurity([action]);
    expect(result.issues.some((i) => i.code === "executable-shell-safety-missing")).toBe(true);
  });

  it("only checks shell-safety for .sh/.bash/.zsh paths or shell shebangs", () => {
    const action = hookAction({
      path: ".claude/hooks/example.py",
      content: "#!/usr/bin/env python3\nprint('hi')\n",
    });
    const result = analyzeExecutableSecurity([action]);
    expect(result.issues.some((i) => i.code === "executable-shell-safety-missing")).toBe(false);
  });
});

describe("analyzeExecutableSecurity — executable-readonly-write", () => {
  it("warns when read-only is declared but the content writes", () => {
    const action = hookAction({
      sideEffects: ["read-only"],
      content: "#!/usr/bin/env bash\nset -euo pipefail\nrm -rf /tmp/x\n",
    });
    const result = analyzeExecutableSecurity([action]);
    expect(result.issues.some((i) => i.code === "executable-readonly-write")).toBe(true);
  });

  it("does not warn for the same write content without read-only declared", () => {
    const action = hookAction({
      content: "#!/usr/bin/env bash\nset -euo pipefail\nrm -rf /tmp/x\n",
    });
    const result = analyzeExecutableSecurity([action]);
    expect(result.issues.some((i) => i.code === "executable-readonly-write")).toBe(false);
  });
});

describe("analyzeExecutableSecurity — executable-network-undeclared", () => {
  const networkContent = "#!/usr/bin/env bash\nset -euo pipefail\ncurl https://example.com\n";

  it("warns when network access is undeclared", () => {
    const result = analyzeExecutableSecurity([hookAction({ content: networkContent })]);
    expect(result.issues.some((i) => i.code === "executable-network-undeclared")).toBe(true);
  });

  it("suppresses the warning when network is declared", () => {
    const result = analyzeExecutableSecurity([
      hookAction({ content: networkContent, sideEffects: ["network"] }),
    ]);
    expect(result.issues.some((i) => i.code === "executable-network-undeclared")).toBe(false);
  });

  it("suppresses the warning when external-production is declared", () => {
    const result = analyzeExecutableSecurity([
      hookAction({ content: networkContent, sideEffects: ["external-production"] }),
    ]);
    expect(result.issues.some((i) => i.code === "executable-network-undeclared")).toBe(false);
  });
});

describe("analyzeExecutableSecurity — executable-credential-touch-undeclared", () => {
  it("warns when .env is referenced without credential-touching declared", () => {
    const result = analyzeExecutableSecurity([
      hookAction({
        content: "#!/usr/bin/env bash\nset -euo pipefail\nsource .env\n",
      }),
    ]);
    expect(
      result.issues.some((i) => i.code === "executable-credential-touch-undeclared"),
    ).toBe(true);
  });

  it("does not warn when credential-touching is declared", () => {
    const result = analyzeExecutableSecurity([
      hookAction({
        content: "#!/usr/bin/env bash\nset -euo pipefail\nsource .env\n",
        sideEffects: ["credential-touching"],
      }),
    ]);
    expect(
      result.issues.some((i) => i.code === "executable-credential-touch-undeclared"),
    ).toBe(false);
  });

  it("does not fire on a commented-out credential-looking line", () => {
    const result = analyzeExecutableSecurity([
      hookAction({
        content: "#!/usr/bin/env bash\nset -euo pipefail\n# source .env\necho ok\n",
      }),
    ]);
    expect(
      result.issues.some((i) => i.code === "executable-credential-touch-undeclared"),
    ).toBe(false);
  });

  it("warns on a private key marker", () => {
    const result = analyzeExecutableSecurity([
      hookAction({
        content:
          "#!/usr/bin/env bash\nset -euo pipefail\necho '-----BEGIN RSA PRIVATE KEY-----'\n",
      }),
    ]);
    expect(
      result.issues.some((i) => i.code === "executable-credential-touch-undeclared"),
    ).toBe(true);
  });
});

describe("analyzeExecutableSecurity — executable-repo-external-write-undeclared", () => {
  it("warns when writing outside the repo without declaring repo-external-write", () => {
    const result = analyzeExecutableSecurity([
      hookAction({
        content: "#!/usr/bin/env bash\nset -euo pipefail\nmkdir -p $HOME/.cache/thing\n",
      }),
    ]);
    expect(
      result.issues.some((i) => i.code === "executable-repo-external-write-undeclared"),
    ).toBe(true);
  });

  it("does not warn when repo-external-write is declared", () => {
    const result = analyzeExecutableSecurity([
      hookAction({
        content: "#!/usr/bin/env bash\nset -euo pipefail\nmkdir -p $HOME/.cache/thing\n",
        sideEffects: ["repo-external-write"],
      }),
    ]);
    expect(
      result.issues.some((i) => i.code === "executable-repo-external-write-undeclared"),
    ).toBe(false);
  });

  it("does not warn when there is an external path reference but no write signal", () => {
    const result = analyzeExecutableSecurity([
      hookAction({
        content: "#!/usr/bin/env bash\nset -euo pipefail\necho $HOME/.cache/thing\n",
      }),
    ]);
    expect(
      result.issues.some((i) => i.code === "executable-repo-external-write-undeclared"),
    ).toBe(false);
  });
});

describe("analyzeExecutableSecurity — executable-external-production-undeclared", () => {
  it("warns for a production-impacting command without external-production declared", () => {
    const result = analyzeExecutableSecurity([
      hookAction({
        content: "#!/usr/bin/env bash\nset -euo pipefail\nkubectl apply -f manifest.yaml\n",
      }),
    ]);
    expect(
      result.issues.some((i) => i.code === "executable-external-production-undeclared"),
    ).toBe(true);
  });

  it("does not warn when external-production is declared", () => {
    const result = analyzeExecutableSecurity([
      hookAction({
        content: "#!/usr/bin/env bash\nset -euo pipefail\nkubectl apply -f manifest.yaml\n",
        sideEffects: ["external-production"],
      }),
    ]);
    expect(
      result.issues.some((i) => i.code === "executable-external-production-undeclared"),
    ).toBe(false);
  });
});

describe("analyzeExecutableSecurity — combined signals and summary shape", () => {
  it("reports multiple issues for a single action and sums them in the summary", () => {
    const action = hookAction({
      content: "#!/usr/bin/env bash\ncurl https://example.com\nrm -rf /tmp/x\n",
    });
    const result = analyzeExecutableSecurity([action]);

    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("executable-shell-safety-missing");
    expect(codes).toContain("executable-network-undeclared");
    expect(result.summary.total).toBe(result.issues.length);
    expect(result.summary.warnings).toBe(
      result.issues.filter((i) => i.severity === "warning").length,
    );
    expect(result.ok).toBe(false);
  });

  it("reports ok: true and a zero-count summary for a clean action set", () => {
    const result = analyzeExecutableSecurity([hookAction()]);
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: 0, warnings: 0, info: 0 });
  });
});
