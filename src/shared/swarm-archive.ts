import { exportWorkflowJson } from "./mcp-headers";
import { stripSecretFields } from "./secret-fields";
import { validateWorkflow } from "./validate-workflow";
import { requiredEnvVarsSchema, workflowSchema, type Workflow } from "./workflow";
import { unzipStore, zipStore } from "./zip-store";

export function packageSwarmArchive(parts: {
  workflowJson: string;
  promptsJson: string;
  requiredEnvVars: readonly string[];
}): Uint8Array {
  return zipStore({
    "workflow.json": parts.workflowJson,
    "prompts.json": parts.promptsJson,
    "requiredEnvVars.json": JSON.stringify(parts.requiredEnvVars),
  });
}

export function exportSwarmArchive(workflow: unknown): Uint8Array {
  const workflowJson = exportWorkflowJson(workflow);
  const parsed = workflowSchema.parse(JSON.parse(workflowJson));
  return packageSwarmArchive({
    workflowJson,
    promptsJson: JSON.stringify(templatePrompts(parsed)),
    requiredEnvVars: parsed.requiredEnvVars ?? [],
  });
}

export type SwarmArchive = {
  workflow: Workflow;
  promptsJson: string;
  requiredEnvVars: string[];
};

export function readSwarmArchive(bytes: Uint8Array): SwarmArchive {
  const files = unzipStore(bytes);
  const workflowJson = files.get("workflow.json");
  if (workflowJson === undefined) {
    throw new Error("The .swarm file has no workflow.json");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(workflowJson);
  } catch {
    throw new Error("workflow.json is not valid JSON");
  }
  const { workflow } = validateWorkflow(stripSecretFields(parsedJson));
  const requiredEnvVars = readRequiredEnvVars(files.get("requiredEnvVars.json"));
  return {
    workflow: applyRequiredEnvVars(workflow, requiredEnvVars),
    promptsJson: files.get("prompts.json") ?? "[]",
    requiredEnvVars,
  };
}

function templatePrompts(workflow: Workflow): {
  id: string;
  label: string;
  systemPrompt: string;
  taskPrompt: string;
}[] {
  return workflow.nodes.flatMap((node) => {
    if (node.type !== "agent" && node.type !== "planner") {
      return [];
    }
    return [
      {
        id: node.id,
        label: node.data.label,
        systemPrompt: node.data.systemPrompt ?? "",
        taskPrompt: node.data.taskPrompt ?? "",
      },
    ];
  });
}

function readRequiredEnvVars(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("requiredEnvVars.json is not valid JSON");
  }
  return requiredEnvVarsSchema.parse(parsed);
}

function applyRequiredEnvVars(workflow: Workflow, requiredEnvVars: readonly string[]): Workflow {
  const next: Workflow = { ...workflow };
  if (requiredEnvVars.length === 0) {
    delete next.requiredEnvVars;
  } else {
    next.requiredEnvVars = [...requiredEnvVars];
  }
  return workflowSchema.parse(next);
}
