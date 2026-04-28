// k8s introspector — walks project YAML files, extracts namespaces,
// services, ingresses, and workloads (Deployment / StatefulSet /
// DaemonSet / Job / CronJob).
//
// Limitations:
//   * Reads YAML only. Helm charts (templated) and Kustomize overlays
//     evaluate at apply time; we report what's literally in the YAML.
//   * Skips runtime-only state (pod status, ClusterIP assignments).
//   * Stable output: arrays sorted by (namespace, name) so re-runs of
//     the bootstrap produce identical files when nothing changed.

import * as fs from "node:fs";
import { parseAllDocuments } from "yaml";
import type { Introspector, OntologyFacts } from "../core/introspector.js";
import type { ProjectContext } from "../core/triggers.js";

const WORKLOAD_KINDS = new Set([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
]);

interface NamespaceFact {
  name: string;
}

interface ServiceFact {
  name: string;
  namespace: string;
  type: string;
  ports: Array<{
    name?: string;
    port: number;
    target?: number | string;
    nodePort?: number;
    protocol?: string;
  }>;
  selector?: Record<string, string>;
}

interface IngressFact {
  name: string;
  namespace: string;
  class?: string;
  hosts: string[];
  rules: Array<{
    host?: string;
    path?: string;
    pathType?: string;
    serviceName?: string;
    servicePort?: number | string;
  }>;
}

interface WorkloadFact {
  kind: string;
  name: string;
  namespace: string;
  replicas?: number;
  images: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function metadataFields(doc: Record<string, unknown>): {
  name: string;
  namespace: string;
} {
  const meta = asObject(doc.metadata) ?? {};
  return {
    name: asString(meta.name) ?? "(unnamed)",
    namespace: asString(meta.namespace) ?? "default",
  };
}

function extractImages(podSpec: Record<string, unknown> | null): string[] {
  if (!podSpec) return [];
  const images: string[] = [];
  for (const key of ["containers", "initContainers"]) {
    const arr = podSpec[key];
    if (Array.isArray(arr)) {
      for (const c of arr) {
        const obj = asObject(c);
        const img = obj && asString(obj.image);
        if (img) images.push(img);
      }
    }
  }
  return images;
}

function workloadPodSpec(
  spec: Record<string, unknown>,
  kind: string,
): Record<string, unknown> | null {
  // CronJob: spec.jobTemplate.spec.template.spec
  if (kind === "CronJob") {
    const job = asObject(spec.jobTemplate);
    const jobSpec = job && asObject(job.spec);
    const tmpl = jobSpec && asObject(jobSpec.template);
    return (tmpl && asObject(tmpl.spec)) ?? null;
  }
  // Job / Deployment / StatefulSet / DaemonSet: spec.template.spec
  const tmpl = asObject(spec.template);
  return (tmpl && asObject(tmpl.spec)) ?? null;
}

function compareByNsName(
  a: { namespace?: string; name: string },
  b: { namespace?: string; name: string },
): number {
  const ns = (a.namespace ?? "").localeCompare(b.namespace ?? "");
  return ns !== 0 ? ns : a.name.localeCompare(b.name);
}

// ---------------------------------------------------------------------------
// Per-kind extractors
// ---------------------------------------------------------------------------

function extractService(doc: Record<string, unknown>): ServiceFact | null {
  const spec = asObject(doc.spec);
  if (!spec) return null;
  const { name, namespace } = metadataFields(doc);
  const ports: ServiceFact["ports"] = [];
  if (Array.isArray(spec.ports)) {
    for (const p of spec.ports) {
      const o = asObject(p);
      if (!o) continue;
      const port = asNumber(o.port);
      if (port === undefined) continue;
      const fact: ServiceFact["ports"][number] = { port };
      const named = asString(o.name);
      if (named) fact.name = named;
      const target = o.targetPort;
      if (typeof target === "number" || typeof target === "string") {
        fact.target = target;
      }
      const nodePort = asNumber(o.nodePort);
      if (nodePort !== undefined) fact.nodePort = nodePort;
      const proto = asString(o.protocol);
      if (proto && proto !== "TCP") fact.protocol = proto;
      ports.push(fact);
    }
  }
  ports.sort((a, b) => a.port - b.port);
  const fact: ServiceFact = {
    name,
    namespace,
    type: asString(spec.type) ?? "ClusterIP",
    ports,
  };
  const sel = asObject(spec.selector);
  if (sel) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(sel)) {
      if (typeof v === "string") out[k] = v;
    }
    if (Object.keys(out).length > 0) fact.selector = out;
  }
  return fact;
}

function extractIngress(doc: Record<string, unknown>): IngressFact | null {
  const spec = asObject(doc.spec);
  if (!spec) return null;
  const { name, namespace } = metadataFields(doc);
  const rules: IngressFact["rules"] = [];
  const hosts = new Set<string>();
  if (Array.isArray(spec.rules)) {
    for (const r of spec.rules) {
      const ro = asObject(r);
      if (!ro) continue;
      const host = asString(ro.host);
      if (host) hosts.add(host);
      const http = asObject(ro.http);
      const paths = http && Array.isArray(http.paths) ? http.paths : [];
      if (paths.length === 0) {
        rules.push({ host });
        continue;
      }
      for (const p of paths) {
        const po = asObject(p);
        if (!po) continue;
        const rule: IngressFact["rules"][number] = {};
        if (host) rule.host = host;
        const pathStr = asString(po.path);
        if (pathStr) rule.path = pathStr;
        const pt = asString(po.pathType);
        if (pt) rule.pathType = pt;
        const backend = asObject(po.backend);
        const svc = backend && asObject(backend.service);
        if (svc) {
          const svcName = asString(svc.name);
          if (svcName) rule.serviceName = svcName;
          const port = asObject(svc.port);
          if (port) {
            const num = asNumber(port.number);
            const named = asString(port.name);
            if (num !== undefined) rule.servicePort = num;
            else if (named) rule.servicePort = named;
          }
        }
        rules.push(rule);
      }
    }
  }
  const fact: IngressFact = {
    name,
    namespace,
    hosts: [...hosts].sort(),
    rules,
  };
  const cls = asString(spec.ingressClassName);
  if (cls) fact.class = cls;
  return fact;
}

function extractWorkload(
  doc: Record<string, unknown>,
  kind: string,
): WorkloadFact | null {
  const spec = asObject(doc.spec);
  if (!spec) return null;
  const { name, namespace } = metadataFields(doc);
  const podSpec = workloadPodSpec(spec, kind);
  const images = [...new Set(extractImages(podSpec))].sort();
  const fact: WorkloadFact = { kind, name, namespace, images };
  const replicas = asNumber(spec.replicas);
  if (replicas !== undefined) fact.replicas = replicas;
  return fact;
}

// ---------------------------------------------------------------------------
// Document scanner
// ---------------------------------------------------------------------------

interface Scan {
  namespaces: NamespaceFact[];
  services: ServiceFact[];
  ingresses: IngressFact[];
  workloads: WorkloadFact[];
}

function scanFile(filePath: string, scan: Scan, seenNs: Set<string>): void {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  // Quick gate: skip files that don't look like k8s.
  if (!text.includes("apiVersion:") || !text.includes("kind:")) return;
  let docs: ReturnType<typeof parseAllDocuments>;
  try {
    docs = parseAllDocuments(text);
  } catch {
    return;
  }
  for (const d of docs) {
    if (d.errors.length > 0) continue;
    const obj = asObject(d.toJS({ maxAliasCount: 100 }));
    if (!obj) continue;
    const kind = asString(obj.kind);
    if (!kind) continue;
    if (kind === "Namespace") {
      const { name } = metadataFields(obj);
      if (!seenNs.has(name)) {
        seenNs.add(name);
        scan.namespaces.push({ name });
      }
      continue;
    }
    if (kind === "Service") {
      const f = extractService(obj);
      if (f) scan.services.push(f);
      continue;
    }
    if (kind === "Ingress") {
      const f = extractIngress(obj);
      if (f) scan.ingresses.push(f);
      continue;
    }
    if (WORKLOAD_KINDS.has(kind)) {
      const f = extractWorkload(obj, kind);
      if (f) scan.workloads.push(f);
      continue;
    }
  }
}

// ---------------------------------------------------------------------------
// Introspector
// ---------------------------------------------------------------------------

export const k8sIntrospector: Introspector = {
  fragmentId: "k8s",
  appliesTo(ctx: ProjectContext): boolean {
    // Cheap heuristic: at least one YAML file mentions both apiVersion
    // and kind. Caller usually only consults us if k8s fragment is
    // installed, so this is mostly a safety net.
    const files = ctx.yamlFiles();
    for (const f of files) {
      try {
        const text = fs.readFileSync(f, "utf8");
        if (text.includes("apiVersion:") && text.includes("kind:")) {
          return true;
        }
      } catch {
        // fall through
      }
    }
    return false;
  },
  introspect(ctx: ProjectContext): OntologyFacts {
    const scan: Scan = {
      namespaces: [],
      services: [],
      ingresses: [],
      workloads: [],
    };
    const seenNs = new Set<string>();
    for (const f of ctx.yamlFiles()) {
      scanFile(f, scan, seenNs);
    }
    // Stable ordering across all collections.
    scan.namespaces.sort((a, b) => a.name.localeCompare(b.name));
    scan.services.sort(compareByNsName);
    scan.ingresses.sort(compareByNsName);
    scan.workloads.sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        compareByNsName(a, b),
    );
    return scan as unknown as OntologyFacts;
  },
};
