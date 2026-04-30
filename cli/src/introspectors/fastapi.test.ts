import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fastapiIntrospector } from "./fastapi.js";
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

describe("fastapi introspector — appliesTo", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject("anamnesis-fastapi-applies-");
  });

  it("returns false when no FastAPI signals exist", () => {
    expect(fastapiIntrospector.appliesTo(new ProjectContext(root))).toBe(false);
  });

  it("returns true when pyproject mentions fastapi", () => {
    write(
      root,
      "pyproject.toml",
      `[project]\ndependencies = ["fastapi>=0.115"]\n`,
    );
    expect(fastapiIntrospector.appliesTo(new ProjectContext(root))).toBe(true);
  });

  it("returns true when requirements.txt mentions fastapi", () => {
    write(root, "requirements.txt", "fastapi==0.115.0\n");
    expect(fastapiIntrospector.appliesTo(new ProjectContext(root))).toBe(true);
  });

  it("returns true for nested FastAPI source", () => {
    write(
      root,
      "services/api/main.py",
      "from fastapi import FastAPI\napp = FastAPI()\n",
    );
    expect(fastapiIntrospector.appliesTo(new ProjectContext(root))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("fastapi introspector — introspect", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject("anamnesis-fastapi-extract-");
  });

  it("extracts app variables and app path operations", () => {
    write(
      root,
      "app/main.py",
      `from fastapi import FastAPI
from .schemas import UserOut

app = FastAPI()

@app.get("/health", tags=["system"])
async def health():
    return {"ok": True}

@app.post(path="/users", response_model=UserOut)
def create_user():
    return {}
`,
    );

    const facts = fastapiIntrospector.introspect(new ProjectContext(root)) as {
      apps: Array<{ variable: string; file: string }>;
      routes: Array<{
        owner: string;
        owner_kind: string;
        methods: string[];
        path: string;
        handler: string;
        file: string;
        response_model?: string;
        tags?: string[];
      }>;
    };

    expect(facts.apps).toEqual([{ variable: "app", file: "app/main.py" }]);
    expect(facts.routes).toContainEqual({
      owner: "app",
      owner_kind: "app",
      methods: ["GET"],
      path: "/health",
      handler: "health",
      file: "app/main.py",
      tags: ["system"],
    });
    expect(facts.routes).toContainEqual({
      owner: "app",
      owner_kind: "app",
      methods: ["POST"],
      path: "/users",
      handler: "create_user",
      file: "app/main.py",
      response_model: "UserOut",
    });
  });

  it("extracts routers, router path operations, and include_router calls", () => {
    write(
      root,
      "app/users.py",
      `from fastapi import APIRouter

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/{user_id}", response_model=UserOut)
async def get_user():
    pass

@router.api_route("/bulk", methods=["POST", "PUT"], tags=["bulk"])
def bulk_users():
    pass
`,
    );
    write(
      root,
      "app/main.py",
      `from fastapi import FastAPI
from .users import router as users_router

app = FastAPI()
app.include_router(users_router, prefix="/api", tags=["v1"])
`,
    );

    const facts = fastapiIntrospector.introspect(new ProjectContext(root)) as {
      routers: Array<{ variable: string; file: string; prefix: string; tags?: string[] }>;
      routes: Array<{ owner: string; owner_kind: string; methods: string[]; path: string; handler: string; tags?: string[] }>;
      includes: Array<{ owner: string; router: string; file: string; prefix?: string; tags?: string[] }>;
    };

    expect(facts.routers).toEqual([
      {
        variable: "router",
        file: "app/users.py",
        prefix: "/users",
        tags: ["users"],
      },
    ]);
    expect(facts.routes).toContainEqual(
      expect.objectContaining({
        owner: "router",
        owner_kind: "router",
        methods: ["GET"],
        path: "/{user_id}",
        handler: "get_user",
        file: "app/users.py",
        response_model: "UserOut",
      }),
    );
    expect(facts.routes).toContainEqual(
      expect.objectContaining({
        owner: "router",
        owner_kind: "router",
        methods: ["POST", "PUT"],
        path: "/bulk",
        handler: "bulk_users",
        file: "app/users.py",
        tags: ["bulk"],
      }),
    );
    expect(facts.includes).toEqual([
      {
        owner: "app",
        router: "users_router",
        file: "app/main.py",
        prefix: "/api",
        tags: ["v1"],
      },
    ]);
  });

  it("keeps an absent APIRouter prefix empty", () => {
    write(
      root,
      "app/health.py",
      `from fastapi import APIRouter

router = APIRouter()

@router.get("")
def health():
    pass
`,
    );

    const facts = fastapiIntrospector.introspect(new ProjectContext(root)) as {
      routers: Array<{ prefix: string }>;
      routes: Array<{ path: string }>;
    };

    expect(facts.routers[0]!.prefix).toBe("");
    expect(facts.routes[0]!.path).toBe("/");
  });

  it("ignores tests and commented path operations", () => {
    write(
      root,
      "tests/test_routes.py",
      `from fastapi import FastAPI\napp = FastAPI()\n@app.get("/ignored")\ndef ignored(): pass\n`,
    );
    write(
      root,
      "app/main.py",
      `from fastapi import FastAPI
app = FastAPI()
# @app.get("/fake")
# def fake(): pass
@app.get("/real")
def real(): pass
`,
    );

    const facts = fastapiIntrospector.introspect(new ProjectContext(root)) as {
      routes: Array<{ path: string; handler: string }>;
    };

    expect(facts.routes).toEqual([
      {
        owner: "app",
        owner_kind: "app",
        methods: ["GET"],
        path: "/real",
        handler: "real",
        file: "app/main.py",
      },
    ]);
  });

  it("marks route owners as unknown when defined elsewhere", () => {
    write(
      root,
      "app/users.py",
      `from .routing import router

@router.delete("/{user_id}")
def delete_user():
    pass
`,
    );

    const facts = fastapiIntrospector.introspect(new ProjectContext(root)) as {
      routes: Array<{ owner_kind: string; path: string }>;
    };

    expect(facts.routes).toEqual([
      {
        owner: "router",
        owner_kind: "unknown",
        methods: ["DELETE"],
        path: "/{user_id}",
        handler: "delete_user",
        file: "app/users.py",
      },
    ]);
  });

  it("produces stable ordering across runs", () => {
    write(
      root,
      "services/b/main.py",
      `from fastapi import FastAPI\napp = FastAPI()\n@app.get("/z")\ndef z(): pass\n`,
    );
    write(
      root,
      "services/a/main.py",
      `from fastapi import FastAPI\napp = FastAPI()\n@app.get("/a")\ndef a(): pass\n`,
    );

    const a = fastapiIntrospector.introspect(new ProjectContext(root));
    const b = fastapiIntrospector.introspect(new ProjectContext(root));

    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    const routes = (a as { routes: Array<{ file: string }> }).routes;
    expect(routes.map((r) => r.file)).toEqual([
      "services/a/main.py",
      "services/b/main.py",
    ]);
  });
});
