import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bootstrap, OntologyBootstrapError } from "./ontology.js";
import { IntrospectorRegistry, type Introspector } from "../core/introspector.js";

function tmpProject(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeAgentfile(
  root: string,
  fragments: Array<{ id: string; version: number }>,
): void {
  const agentfile = `version: 1
project:
  name: test
tools: [claude-code]
fragments:
${fragments.map((f) => `  - id: ${f.id}\n    version: ${f.version}`).join("\n")}
`;
  fs.writeFileSync(path.join(root, "Agentfile"), agentfile, "utf8");
}

function write(root: string, rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, "utf8");
}

function makeFakeIntrospector(
  fragmentId: string,
  facts: Record<string, unknown>,
  applies = true,
): Introspector {
  return {
    fragmentId,
    appliesTo: () => applies,
    introspect: () => facts,
  };
}

// ---------------------------------------------------------------------------

describe("ontology bootstrap", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject("anamnesis-bootstrap-");
  });

  it("throws if no Agentfile present", () => {
    expect(() =>
      bootstrap({ projectRoot: root, registry: new IntrospectorRegistry() }),
    ).toThrow(OntologyBootstrapError);
  });

  it("writes <id>.bootstrap.yaml when introspector applies", () => {
    writeAgentfile(root, [{ id: "k8s", version: 1 }]);
    const reg = new IntrospectorRegistry();
    reg.register(
      makeFakeIntrospector("k8s", {
        namespaces: [{ name: "alpha" }, { name: "beta" }],
        services: [],
        ingresses: [],
        workloads: [],
      }),
    );
    const result = bootstrap({ projectRoot: root, registry: reg });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.outcome).toBe("written");
    expect(result.writtenToDisk).toBe(true);
    const fp = path.join(root, ".anamnesis", "ontology", "k8s.bootstrap.yaml");
    expect(fs.existsSync(fp)).toBe(true);
    const content = fs.readFileSync(fp, "utf8");
    expect(content).toContain("AUTO-GENERATED");
    expect(content).toContain("introspector=k8s");
    expect(content).toContain("alpha");
    expect(content).toContain("beta");
  });

  it("dry-run does not write", () => {
    writeAgentfile(root, [{ id: "k8s", version: 1 }]);
    const reg = new IntrospectorRegistry();
    reg.register(makeFakeIntrospector("k8s", { namespaces: [] }));
    const result = bootstrap({
      projectRoot: root,
      registry: reg,
      dryRun: true,
    });
    expect(result.writtenToDisk).toBe(false);
    expect(
      fs.existsSync(
        path.join(root, ".anamnesis", "ontology", "k8s.bootstrap.yaml"),
      ),
    ).toBe(false);
  });

  it("reports unchanged when re-run produces identical content", () => {
    writeAgentfile(root, [{ id: "k8s", version: 1 }]);
    const reg = new IntrospectorRegistry();
    reg.register(makeFakeIntrospector("k8s", { namespaces: [] }));
    bootstrap({ projectRoot: root, registry: reg });
    const r2 = bootstrap({ projectRoot: root, registry: reg });
    expect(r2.entries[0]!.outcome).toBe("unchanged");
    expect(r2.writtenToDisk).toBe(false);
  });

  it("skips fragments without a registered introspector", () => {
    writeAgentfile(root, [{ id: "no-such", version: 1 }]);
    const result = bootstrap({
      projectRoot: root,
      registry: new IntrospectorRegistry(),
    });
    expect(result.entries[0]!.outcome).toBe("skipped-no-introspector");
  });

  it("skips when introspector says appliesTo=false", () => {
    writeAgentfile(root, [{ id: "k8s", version: 1 }]);
    const reg = new IntrospectorRegistry();
    reg.register(makeFakeIntrospector("k8s", {}, false));
    const result = bootstrap({ projectRoot: root, registry: reg });
    expect(result.entries[0]!.outcome).toBe("skipped-not-applicable");
    expect(result.writtenToDisk).toBe(false);
  });

  it("filters by --fragment flag", () => {
    writeAgentfile(root, [
      { id: "k8s", version: 1 },
      { id: "prisma", version: 1 },
    ]);
    const reg = new IntrospectorRegistry();
    reg.register(makeFakeIntrospector("k8s", { namespaces: [] }));
    reg.register(makeFakeIntrospector("prisma", { models: [] }));
    const result = bootstrap({
      projectRoot: root,
      registry: reg,
      fragment: "prisma",
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.fragmentId).toBe("prisma");
  });

  it("throws if --fragment names an uninstalled fragment", () => {
    writeAgentfile(root, [{ id: "k8s", version: 1 }]);
    expect(() =>
      bootstrap({
        projectRoot: root,
        registry: new IntrospectorRegistry(),
        fragment: "nope",
      }),
    ).toThrow(/not installed/);
  });

  it("uses builtin framework introspectors end-to-end", () => {
    writeAgentfile(root, [
      { id: "nextjs", version: 1 },
      { id: "nestjs", version: 1 },
      { id: "fastapi", version: 1 },
    ]);
    write(root, "app/page.tsx", "export default function Page() {}\n");
    write(
      root,
      "src/users.controller.ts",
      `@Controller('users')
export class UsersController {
  @Get(':id')
  findOne() {}
}
`,
    );
    write(
      root,
      "api/main.py",
      `from fastapi import FastAPI
app = FastAPI()
@app.get("/health")
def health(): pass
`,
    );

    const result = bootstrap({ projectRoot: root });

    expect(result.entries.filter((e) => e.outcome === "written")).toHaveLength(3);
    const next = fs.readFileSync(
      path.join(root, ".anamnesis/ontology/nextjs.bootstrap.yaml"),
      "utf8",
    );
    const nest = fs.readFileSync(
      path.join(root, ".anamnesis/ontology/nestjs.bootstrap.yaml"),
      "utf8",
    );
    const fast = fs.readFileSync(
      path.join(root, ".anamnesis/ontology/fastapi.bootstrap.yaml"),
      "utf8",
    );
    expect(next).toContain("introspector=nextjs");
    expect(next).toContain("app/page.tsx");
    expect(nest).toContain("UsersController");
    expect(nest).toContain("/users/:id");
    expect(fast).toContain("/health");
  });

  it("writes bootstrap output under each effective scope", () => {
    write(
      root,
      "Agentfile",
      `version: 1
project:
  name: mono
  scopes:
    - path: .
    - path: apps/web
      extends: .
      overrides:
        fragments_add:
          - { id: nextjs, version: 1 }
    - path: services/api
      overrides:
        tools: [claude-code]
        fragments_add:
          - { id: fastapi, version: 1 }
tools: [claude-code]
fragments:
  - { id: base, version: 5 }
`,
    );
    write(root, "apps/web/app/page.tsx", "export default function Page() {}\n");
    write(
      root,
      "services/api/main.py",
      `from fastapi import FastAPI
app = FastAPI()
@app.get("/health")
def health(): pass
`,
    );

    const result = bootstrap({ projectRoot: root });

    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopePath: "apps/web",
          fragmentId: "nextjs",
          outcome: "written",
          path: "apps/web/.anamnesis/ontology/nextjs.bootstrap.yaml",
        }),
        expect.objectContaining({
          scopePath: "services/api",
          fragmentId: "fastapi",
          outcome: "written",
          path: "services/api/.anamnesis/ontology/fastapi.bootstrap.yaml",
        }),
      ]),
    );
    expect(
      fs.existsSync(path.join(root, ".anamnesis/ontology/nextjs.bootstrap.yaml")),
    ).toBe(false);
    expect(
      fs.readFileSync(
        path.join(root, "apps/web/.anamnesis/ontology/nextjs.bootstrap.yaml"),
        "utf8",
      ),
    ).toContain("app/page.tsx");
    expect(
      fs.readFileSync(
        path.join(
          root,
          "services/api/.anamnesis/ontology/fastapi.bootstrap.yaml",
        ),
        "utf8",
      ),
    ).toContain("/health");
  });

  it("filters --fragment across scopes", () => {
    write(
      root,
      "Agentfile",
      `version: 1
project:
  name: mono
  scopes:
    - path: .
    - path: apps/web
      overrides:
        tools: [claude-code]
        fragments_add:
          - { id: nextjs, version: 1 }
    - path: services/api
      overrides:
        tools: [claude-code]
        fragments_add:
          - { id: fastapi, version: 1 }
tools: [claude-code]
fragments: []
`,
    );
    write(root, "apps/web/app/page.tsx", "export default function Page() {}\n");
    write(
      root,
      "services/api/main.py",
      `from fastapi import FastAPI
app = FastAPI()
@app.get("/health")
def health(): pass
`,
    );

    const result = bootstrap({ projectRoot: root, fragment: "fastapi" });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      scopePath: "services/api",
      fragmentId: "fastapi",
      outcome: "written",
    });
    expect(
      fs.existsSync(
        path.join(root, "apps/web/.anamnesis/ontology/nextjs.bootstrap.yaml"),
      ),
    ).toBe(false);
  });
});
