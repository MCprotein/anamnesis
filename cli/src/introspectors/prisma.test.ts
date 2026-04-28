import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prismaIntrospector } from "./prisma.js";
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

describe("prisma introspector — appliesTo", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject("anamnesis-prisma-applies-");
  });

  it("returns false when no schema.prisma anywhere", () => {
    expect(prismaIntrospector.appliesTo(new ProjectContext(root))).toBe(false);
  });

  it("returns true when schema.prisma exists at root level", () => {
    write(root, "prisma/schema.prisma", "datasource db { provider = \"postgresql\" }\n");
    expect(prismaIntrospector.appliesTo(new ProjectContext(root))).toBe(true);
  });

  it("returns true for monorepo nested schema", () => {
    write(
      root,
      "apps/api/prisma/schema.prisma",
      `datasource db { provider = "postgresql" }`,
    );
    expect(prismaIntrospector.appliesTo(new ProjectContext(root))).toBe(true);
  });

  it("ignores schemas under node_modules", () => {
    write(root, "node_modules/foo/schema.prisma", "datasource db {}");
    expect(prismaIntrospector.appliesTo(new ProjectContext(root))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("prisma introspector — introspect", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject("anamnesis-prisma-extract-");
  });

  it("extracts datasource, generator, model, enum", () => {
    write(
      root,
      "prisma/schema.prisma",
      `generator client {
  provider = "prisma-client-js"
  output   = "./gen"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  role      Role     @default(USER)
  posts     Post[]
  createdAt DateTime @default(now())

  @@index([email])
}

model Post {
  id     Int    @id @default(autoincrement())
  title  String
  author User   @relation(fields: [authorId], references: [id])
  authorId Int
}
`,
    );
    const ctx = new ProjectContext(root);
    const facts = prismaIntrospector.introspect(ctx) as {
      datasources: { name: string; provider: string }[];
      generators: { name: string; provider: string; output?: string }[];
      models: Array<{ name: string; file: string; fields: { name: string; type: string; attributes: string[] }[] }>;
      enums: { name: string; values: string[] }[];
    };
    expect(facts.datasources).toEqual([{ name: "db", provider: "postgresql" }]);
    expect(facts.generators[0]!.provider).toBe("prisma-client-js");
    expect(facts.generators[0]!.output).toBe("./gen");
    expect(facts.enums[0]!.name).toBe("Role");
    expect(facts.enums[0]!.values).toEqual(["USER", "ADMIN"]);

    expect(facts.models).toHaveLength(2);
    const post = facts.models.find((m) => m.name === "Post")!;
    const user = facts.models.find((m) => m.name === "User")!;
    expect(user.fields.find((f) => f.name === "id")!.attributes).toContain("@id");
    expect(user.fields.find((f) => f.name === "posts")!.type).toBe("Post[]");
    expect(post.fields.find((f) => f.name === "author")!.type).toBe("User");
    expect(post.fields.find((f) => f.name === "author")!.attributes.some((a) => a.startsWith("@relation"))).toBe(true);
  });

  it("handles multi-file schemas", () => {
    write(
      root,
      "prisma/schema.prisma",
      `datasource db {\n  provider = "postgresql"\n}\n`,
    );
    write(
      root,
      "prisma/users.prisma",
      `model User {\n  id Int @id\n}\n`,
    );
    write(
      root,
      "prisma/posts.prisma",
      `model Post {\n  id Int @id\n}\n`,
    );
    const facts = prismaIntrospector.introspect(new ProjectContext(root)) as {
      models: { name: string; file: string }[];
    };
    expect(facts.models.map((m) => m.name).sort()).toEqual(["Post", "User"]);
  });

  it("produces stable ordering across runs", () => {
    write(
      root,
      "apps/b/prisma/schema.prisma",
      `model Z {\n  id Int @id\n}\n\nmodel A {\n  id Int @id\n}\n`,
    );
    write(
      root,
      "apps/a/prisma/schema.prisma",
      `model M {\n  id Int @id\n}\n`,
    );
    const a = prismaIntrospector.introspect(new ProjectContext(root));
    const b = prismaIntrospector.introspect(new ProjectContext(root));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    const models = (a as { models: { name: string; file: string }[] }).models;
    // Sorted by (file, name): apps/a/...M then apps/b/...A then apps/b/...Z
    expect(models.map((m) => `${m.file}::${m.name}`)).toEqual([
      "apps/a/prisma/schema.prisma::M",
      "apps/b/prisma/schema.prisma::A",
      "apps/b/prisma/schema.prisma::Z",
    ]);
  });

  it("strips line comments", () => {
    write(
      root,
      "prisma/schema.prisma",
      `// header comment
model X {
  id Int @id // primary key
  // tail comment
  name String
}
`,
    );
    const facts = prismaIntrospector.introspect(new ProjectContext(root)) as {
      models: { name: string; fields: { name: string }[] }[];
    };
    expect(facts.models[0]!.fields.map((f) => f.name)).toEqual(["id", "name"]);
  });
});
