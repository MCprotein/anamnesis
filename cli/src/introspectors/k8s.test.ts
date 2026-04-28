import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { k8sIntrospector } from "./k8s.js";
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

describe("k8s introspector — appliesTo", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject("anamnesis-k8s-applies-");
  });

  it("returns false when no YAML files", () => {
    expect(k8sIntrospector.appliesTo(new ProjectContext(root))).toBe(false);
  });

  it("returns false when YAMLs lack apiVersion/kind", () => {
    write(root, "config.yaml", "foo: bar\nbaz: 1\n");
    expect(k8sIntrospector.appliesTo(new ProjectContext(root))).toBe(false);
  });

  it("returns true when at least one YAML looks like k8s", () => {
    write(
      root,
      "manifest.yaml",
      "apiVersion: v1\nkind: Service\nmetadata:\n  name: x\n",
    );
    expect(k8sIntrospector.appliesTo(new ProjectContext(root))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("k8s introspector — introspect", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject("anamnesis-k8s-extract-");
  });

  it("extracts namespaces, services, ingresses, workloads", () => {
    write(
      root,
      "k8s/zot/namespace.yaml",
      `apiVersion: v1
kind: Namespace
metadata:
  name: zot
`,
    );
    write(
      root,
      "k8s/zot/service.yaml",
      `apiVersion: v1
kind: Service
metadata:
  name: zot
  namespace: zot
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 5000
      targetPort: 5000
  selector:
    app: zot
`,
    );
    write(
      root,
      "k8s/zot/ingress.yaml",
      `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: zot
  namespace: zot
spec:
  ingressClassName: traefik
  rules:
    - host: registry.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: zot
                port:
                  number: 5000
`,
    );
    write(
      root,
      "k8s/zot/deployment.yaml",
      `apiVersion: apps/v1
kind: Deployment
metadata:
  name: zot
  namespace: zot
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: zot
          image: ghcr.io/project-zot/zot:v2.0.0
`,
    );
    const ctx = new ProjectContext(root);
    const facts = k8sIntrospector.introspect(ctx) as {
      namespaces: { name: string }[];
      services: Array<{ name: string; namespace: string; ports: { port: number }[] }>;
      ingresses: Array<{ name: string; hosts: string[]; rules: { path?: string }[] }>;
      workloads: Array<{ kind: string; name: string; namespace: string; replicas?: number; images: string[] }>;
    };
    expect(facts.namespaces).toEqual([{ name: "zot" }]);
    expect(facts.services).toHaveLength(1);
    expect(facts.services[0]!.name).toBe("zot");
    expect(facts.services[0]!.namespace).toBe("zot");
    expect(facts.services[0]!.ports[0]!.port).toBe(5000);
    expect(facts.ingresses).toHaveLength(1);
    expect(facts.ingresses[0]!.hosts).toEqual(["registry.example.com"]);
    expect(facts.workloads).toHaveLength(1);
    expect(facts.workloads[0]!.kind).toBe("Deployment");
    expect(facts.workloads[0]!.replicas).toBe(1);
    expect(facts.workloads[0]!.images).toEqual([
      "ghcr.io/project-zot/zot:v2.0.0",
    ]);
  });

  it("handles multi-doc YAML files", () => {
    write(
      root,
      "k8s/multi.yaml",
      `apiVersion: v1
kind: Namespace
metadata:
  name: a
---
apiVersion: v1
kind: Namespace
metadata:
  name: b
---
apiVersion: v1
kind: Service
metadata:
  name: svc
  namespace: a
spec:
  ports:
    - port: 80
`,
    );
    const ctx = new ProjectContext(root);
    const facts = k8sIntrospector.introspect(ctx) as {
      namespaces: { name: string }[];
      services: Array<{ name: string; namespace: string }>;
    };
    expect(facts.namespaces.map((n) => n.name)).toEqual(["a", "b"]);
    expect(facts.services).toHaveLength(1);
    expect(facts.services[0]!.namespace).toBe("a");
  });

  it("produces stable ordering across runs", () => {
    write(
      root,
      "k8s/a.yaml",
      `apiVersion: v1
kind: Service
metadata: { name: svc-z, namespace: zz }
spec: { ports: [ { port: 9 }, { port: 1 } ] }
`,
    );
    write(
      root,
      "k8s/b.yaml",
      `apiVersion: v1
kind: Service
metadata: { name: svc-a, namespace: aa }
spec: { ports: [ { port: 80 } ] }
`,
    );
    const ctx = new ProjectContext(root);
    const a = k8sIntrospector.introspect(ctx) as {
      services: Array<{ name: string; namespace: string; ports: { port: number }[] }>;
    };
    const b = k8sIntrospector.introspect(ctx) as typeof a;
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    // Sorted by (namespace, name) — aa/svc-a comes before zz/svc-z
    expect(a.services[0]!.namespace).toBe("aa");
    expect(a.services[1]!.namespace).toBe("zz");
    // Ports sorted ascending
    expect(a.services[1]!.ports.map((p) => p.port)).toEqual([1, 9]);
  });

  it("ignores non-k8s YAML files", () => {
    write(root, "config.yaml", "foo: bar\nlist:\n  - a\n  - b\n");
    write(
      root,
      "k8s/svc.yaml",
      `apiVersion: v1
kind: Service
metadata: { name: only, namespace: default }
spec: { ports: [{ port: 1 }] }
`,
    );
    const ctx = new ProjectContext(root);
    const facts = k8sIntrospector.introspect(ctx) as {
      services: Array<{ name: string }>;
    };
    expect(facts.services.map((s) => s.name)).toEqual(["only"]);
  });

  it("extracts CronJob images via jobTemplate.spec.template.spec", () => {
    write(
      root,
      "k8s/cron.yaml",
      `apiVersion: batch/v1
kind: CronJob
metadata: { name: backup, namespace: ops }
spec:
  schedule: "0 0 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: backup:1.2.3
`,
    );
    const ctx = new ProjectContext(root);
    const facts = k8sIntrospector.introspect(ctx) as {
      workloads: Array<{ kind: string; images: string[] }>;
    };
    expect(facts.workloads).toHaveLength(1);
    expect(facts.workloads[0]!.kind).toBe("CronJob");
    expect(facts.workloads[0]!.images).toEqual(["backup:1.2.3"]);
  });
});
