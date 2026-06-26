import * as fs from "node:fs";
import * as path from "node:path";
import type {
  CapabilityRenderer,
  FileAction,
  RenderAction,
  RenderContext,
} from "../core/render.js";
import { RenderError } from "../core/render.js";
import type { ToolName } from "../core/agentfile.js";

function assertTaskHarnessCapability(
  capability: Parameters<CapabilityRenderer["plan"]>[0],
): asserts capability is Extract<
  Parameters<CapabilityRenderer["plan"]>[0],
  { type: "task_harness" }
> {
  if (capability.type !== "task_harness") {
    throw new RenderError(
      `task_harness renderer given wrong capability type: ${capability.type}`,
    );
  }
}

export function taskHarnessTargetPath(name: string): string {
  return path.posix.join(".anamnesis/task-harnesses", `${name}.yaml`);
}

export function planTaskHarnessFile(
  capability: Parameters<CapabilityRenderer["plan"]>[0],
  ctx: RenderContext,
): FileAction {
  assertTaskHarnessCapability(capability);

  const sourcePath = path.join(ctx.fragmentDir, capability.source);
  if (!fs.existsSync(sourcePath)) {
    throw new RenderError(
      `fragment '${ctx.fragment.id}' task_harness '${capability.name}' source not found: ${sourcePath}`,
    );
  }
  if (!fs.statSync(sourcePath).isFile()) {
    throw new RenderError(
      `fragment '${ctx.fragment.id}' task_harness '${capability.name}' source must be a file: ${sourcePath}`,
    );
  }

  return {
    kind: "file",
    path: taskHarnessTargetPath(capability.name),
    fragmentId: ctx.fragment.id,
    fragmentVersion: ctx.fragment.version,
    content: fs.readFileSync(sourcePath, "utf8"),
  };
}

export function createTaskHarnessRenderer(adapter: ToolName): CapabilityRenderer {
  return {
    type: "task_harness",
    adapter,
    plan(capability, ctx): RenderAction[] {
      return [planTaskHarnessFile(capability, ctx)];
    },
  };
}
