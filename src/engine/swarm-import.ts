import { readSwarmArchive } from "@shared/swarm-archive";
import { workflowSchema, type Workflow } from "@shared/workflow";
import type { WorkflowSummary } from "@shared/workflows";
import type { WorkflowDb } from "./workflow-db";

export type SwarmImportResult = {
  saved: boolean;
  missingSecrets: string[];
  workflow: Workflow;
  summary?: WorkflowSummary;
};

export function importSwarmArchive(
  db: WorkflowDb,
  bytes: Uint8Array,
  knownSecrets: ReadonlySet<string>,
  id: string,
): SwarmImportResult {
  const archive = readSwarmArchive(bytes);
  const workflow = workflowSchema.parse({
    ...archive.workflow,
    id,
    name: uniqueWorkflowName(db, archive.workflow.name),
  });
  const missingSecrets = archive.requiredEnvVars.filter((name) => !knownSecrets.has(name));
  if (missingSecrets.length > 0) {
    return { saved: false, missingSecrets, workflow };
  }
  const summary = db.save(workflow);
  return { saved: true, missingSecrets: [], workflow, summary };
}

function uniqueWorkflowName(db: WorkflowDb, name: string): string {
  const taken = new Set(db.list().map((row) => row.name));
  if (!taken.has(name)) {
    return name;
  }
  let n = 2;
  let candidate = `${name} ${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${name} ${n}`;
  }
  return candidate;
}
