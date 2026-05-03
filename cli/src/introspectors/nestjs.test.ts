import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { nestjsIntrospector } from "./nestjs.js";
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

describe("nestjs introspector — appliesTo", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject("anamnesis-nestjs-applies-");
  });

  it("returns false when no NestJS signals exist", () => {
    expect(nestjsIntrospector.appliesTo(new ProjectContext(root))).toBe(false);
  });

  it("returns true when package.json depends on @nestjs/core", () => {
    write(
      root,
      "package.json",
      JSON.stringify({ dependencies: { "@nestjs/core": "11.0.0" } }),
    );
    expect(nestjsIntrospector.appliesTo(new ProjectContext(root))).toBe(true);
  });

  it("returns true when nest-cli.json exists", () => {
    write(root, "nest-cli.json", "{}\n");
    expect(nestjsIntrospector.appliesTo(new ProjectContext(root))).toBe(true);
  });

  it("returns true for a nested controller file", () => {
    write(
      root,
      "apps/api/src/users.controller.ts",
      `@Controller('users')\nexport class UsersController {}`,
    );
    expect(nestjsIntrospector.appliesTo(new ProjectContext(root))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("nestjs introspector — introspect", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject("anamnesis-nestjs-extract-");
  });

  it("extracts controller prefix and HTTP handler routes", () => {
    write(
      root,
      "src/users.controller.ts",
      `import { Controller, Get, Post, Body } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Get()
  list() {}

  @Get(':id')
  async findOne() {}

  @Post()
  create(@Body() body: unknown) {}
}
`,
    );

    const facts = nestjsIntrospector.introspect(new ProjectContext(root)) as {
      controllers: Array<{
        class: string;
        file: string;
        prefix: string;
        routes: Array<{ method: string; path: string; handler: string }>;
      }>;
    };

    expect(facts.controllers).toEqual([
      {
        class: "UsersController",
        file: "src/users.controller.ts",
        prefix: "users",
        routes: [
          { method: "GET", path: "/users", handler: "list" },
          { method: "POST", path: "/users", handler: "create" },
          { method: "GET", path: "/users/:id", handler: "findOne" },
        ],
      },
    ]);
  });

  it("handles object controller decorators and stacked method decorators", () => {
    write(
      root,
      "src/admin.controller.ts",
      `import { Controller, Delete, UseGuards } from '@nestjs/common';

@Controller({ path: 'admin' })
export class AdminController {
  @Delete('users/:id')
  @UseGuards(AuthGuard)
  removeUser() {}
}
`,
    );

    const facts = nestjsIntrospector.introspect(new ProjectContext(root)) as {
      controllers: Array<{
        prefix: string;
        routes: Array<{ method: string; path: string; handler: string }>;
      }>;
    };

    expect(facts.controllers[0]).toMatchObject({
      prefix: "admin",
      routes: [
        { method: "DELETE", path: "/admin/users/:id", handler: "removeUser" },
      ],
    });
  });

  it("handles root controllers and All routes", () => {
    write(
      root,
      "src/health.controller.ts",
      `@Controller()
export class HealthController {
  @All('health')
  check() {}
}
`,
    );

    const facts = nestjsIntrospector.introspect(new ProjectContext(root)) as {
      controllers: Array<{ prefix: string; routes: Array<{ method: string; path: string; handler: string }> }>;
    };

    expect(facts.controllers[0]).toMatchObject({
      prefix: "",
      routes: [{ method: "ALL", path: "/health", handler: "check" }],
    });
  });

  it("extracts Server-Sent Events routes as deterministic route facts", () => {
    write(
      root,
      "src/notifications.controller.ts",
      `import { Controller, Sse } from '@nestjs/common';

@Controller('notifications')
export class NotificationController {
  @Sse('stream')
  stream() {}
}
`,
    );

    const facts = nestjsIntrospector.introspect(new ProjectContext(root)) as {
      controllers: Array<{ prefix: string; routes: Array<{ method: string; path: string; handler: string }> }>;
    };

    expect(facts.controllers[0]).toMatchObject({
      prefix: "notifications",
      routes: [
        { method: "SSE", path: "/notifications/stream", handler: "stream" },
      ],
    });
  });

  it("ignores spec files and comments", () => {
    write(
      root,
      "src/ignored.controller.spec.ts",
      `@Controller('ignored')\nexport class IgnoredController {}`,
    );
    write(
      root,
      "src/real.controller.ts",
      `// @Controller('fake')
@Controller('real')
export class RealController {
  // @Get('fake')
  @Get()
  list() {}
}
`,
    );

    const facts = nestjsIntrospector.introspect(new ProjectContext(root)) as {
      controllers: Array<{ class: string; routes: Array<{ path: string }> }>;
    };

    expect(facts.controllers.map((c) => c.class)).toEqual(["RealController"]);
    expect(facts.controllers[0]!.routes.map((r) => r.path)).toEqual(["/real"]);
  });

  it("produces stable ordering across runs", () => {
    write(
      root,
      "apps/b/src/z.controller.ts",
      `@Controller('z')\nexport class ZController { @Get() list() {} }`,
    );
    write(
      root,
      "apps/a/src/a.controller.ts",
      `@Controller('a')\nexport class AController { @Get() list() {} }`,
    );

    const a = nestjsIntrospector.introspect(new ProjectContext(root));
    const b = nestjsIntrospector.introspect(new ProjectContext(root));

    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    const controllers = (a as { controllers: Array<{ file: string }> }).controllers;
    expect(controllers.map((c) => c.file)).toEqual([
      "apps/a/src/a.controller.ts",
      "apps/b/src/z.controller.ts",
    ]);
  });
});
