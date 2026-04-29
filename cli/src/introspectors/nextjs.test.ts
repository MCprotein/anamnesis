import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { nextjsIntrospector } from "./nextjs.js";
import { ProjectContext } from "../core/triggers.js";

function tmpProject(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(root: string, rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, "utf8");
}

// ---------------------------------------------------------------------------

describe("nextjs introspector — appliesTo", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject("anamnesis-nextjs-applies-");
  });

  it("returns false when no Next.js signals exist", () => {
    expect(nextjsIntrospector.appliesTo(new ProjectContext(root))).toBe(false);
  });

  it("returns true when package.json depends on next", () => {
    write(
      root,
      "package.json",
      JSON.stringify({ dependencies: { next: "15.0.0" } }),
    );
    expect(nextjsIntrospector.appliesTo(new ProjectContext(root))).toBe(true);
  });

  it("returns true when next.config exists", () => {
    write(root, "next.config.mjs", "export default {};\n");
    expect(nextjsIntrospector.appliesTo(new ProjectContext(root))).toBe(true);
  });

  it("returns true for nested monorepo app routes", () => {
    write(root, "apps/web/app/page.tsx", "export default function Page() {}\n");
    expect(nextjsIntrospector.appliesTo(new ProjectContext(root))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("nextjs introspector — introspect", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject("anamnesis-nextjs-extract-");
  });

  it("extracts App Router pages, route handlers, and methods", () => {
    write(root, "app/page.tsx", "export default function Home() {}\n");
    write(
      root,
      "app/blog/[slug]/page.tsx",
      "export default function Post() {}\n",
    );
    write(
      root,
      "app/api/users/route.ts",
      "export async function GET() {}\nexport const POST = async () => {};\n",
    );

    const facts = nextjsIntrospector.introspect(new ProjectContext(root)) as {
      routes: Array<{
        router: string;
        kind: string;
        path: string;
        file: string;
        methods?: string[];
      }>;
    };

    expect(facts.routes).toContainEqual({
      router: "app",
      kind: "page",
      path: "/",
      file: "app/page.tsx",
    });
    expect(facts.routes).toContainEqual({
      router: "app",
      kind: "page",
      path: "/blog/[slug]",
      file: "app/blog/[slug]/page.tsx",
    });
    expect(facts.routes).toContainEqual({
      router: "app",
      kind: "route_handler",
      path: "/api/users",
      file: "app/api/users/route.ts",
      methods: ["GET", "POST"],
    });
  });

  it("omits route groups and parallel route slots from App Router paths", () => {
    write(
      root,
      "app/(marketing)/@modal/pricing/page.tsx",
      "export default function Pricing() {}\n",
    );

    const facts = nextjsIntrospector.introspect(new ProjectContext(root)) as {
      routes: Array<{ path: string; file: string }>;
    };

    expect(facts.routes).toEqual([
      {
        router: "app",
        kind: "page",
        path: "/pricing",
        file: "app/(marketing)/@modal/pricing/page.tsx",
      },
    ]);
  });

  it("extracts Pages Router pages and API routes", () => {
    write(root, "pages/index.tsx", "export default function Home() {}\n");
    write(root, "pages/about.tsx", "export default function About() {}\n");
    write(root, "pages/blog/[slug].tsx", "export default function Post() {}\n");
    write(root, "pages/api/health.ts", "export default function handler() {}\n");
    write(root, "pages/_app.tsx", "export default function App() {}\n");

    const facts = nextjsIntrospector.introspect(new ProjectContext(root)) as {
      routes: Array<{ router: string; kind: string; path: string; file: string }>;
    };

    expect(facts.routes.map((r) => `${r.kind}:${r.path}`)).toEqual([
      "page:/",
      "page:/about",
      "api_route:/api/health",
      "page:/blog/[slug]",
    ]);
    expect(facts.routes.some((r) => r.file === "pages/_app.tsx")).toBe(false);
  });

  it("reports middleware files", () => {
    write(root, "middleware.ts", "export function middleware() {}\n");
    write(root, "src/middleware.ts", "export function middleware() {}\n");
    write(root, "src/server/middleware.ts", "export function middleware() {}\n");

    const facts = nextjsIntrospector.introspect(new ProjectContext(root)) as {
      middleware: Array<{ file: string }>;
    };

    expect(facts.middleware).toEqual([
      { file: "middleware.ts" },
      { file: "src/middleware.ts" },
    ]);
  });

  it("produces stable ordering across runs", () => {
    write(root, "apps/b/app/z/page.tsx", "export default function Z() {}\n");
    write(root, "apps/a/app/a/page.tsx", "export default function A() {}\n");

    const a = nextjsIntrospector.introspect(new ProjectContext(root));
    const b = nextjsIntrospector.introspect(new ProjectContext(root));

    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    const routes = (a as { routes: Array<{ file: string }> }).routes;
    expect(routes.map((r) => r.file)).toEqual([
      "apps/a/app/a/page.tsx",
      "apps/b/app/z/page.tsx",
    ]);
  });
});
