import { ZodError } from "zod";
import { getNodeType } from "./node-registry";
import { workflowSchema, type Workflow } from "./workflow";

export type WorkflowConnection = {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};

export class WorkflowValidationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(errors.join("\n"));
    this.name = "WorkflowValidationError";
    this.errors = errors;
  }
}

export type ValidatedWorkflow = {
  workflow: Workflow;
  tiers: string[][];
};

export function validateWorkflow(input: unknown): ValidatedWorkflow {
  const parsed = workflowSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowValidationError(schemaErrors(parsed.error));
  }

  const workflow = parsed.data;
  const duplicateErrors = duplicateIdErrors(workflow);
  if (duplicateErrors.length > 0) {
    throw new WorkflowValidationError(duplicateErrors);
  }

  const errors = [
    ...unknownTypeErrors(workflow),
    ...edgeErrors(workflow),
    ...cycleErrors(workflow),
  ];
  if (errors.length > 0) {
    throw new WorkflowValidationError(errors);
  }

  return { workflow, tiers: parallelTiers(workflow) };
}

export function connectError(workflow: Workflow, connection: WorkflowConnection): string | undefined {
  const taken = new Set(workflow.edges.map((edge) => edge.id));
  let draft = workflow.edges.length + 1;
  let id = `draft-${draft}`;
  while (taken.has(id)) {
    draft += 1;
    id = `draft-${draft}`;
  }

  try {
    validateWorkflow({
      ...workflow,
      edges: [...workflow.edges, { id, ...connection }],
    });
    return undefined;
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return error.message;
    }
    throw error;
  }
}

function schemaErrors(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

function duplicateIdErrors(workflow: Workflow): string[] {
  return [
    ...repeated(workflow.nodes.map((node) => node.id)).map((id) => `Duplicate node id "${id}"`),
    ...repeated(workflow.edges.map((edge) => edge.id)).map((id) => `Duplicate edge id "${id}"`),
  ];
}

function repeated(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      if (!duplicates.includes(id)) duplicates.push(id);
      continue;
    }
    seen.add(id);
  }
  return duplicates;
}

function unknownTypeErrors(workflow: Workflow): string[] {
  return workflow.nodes.flatMap((node) =>
    getNodeType(node.type) ? [] : [`Unknown node type "${node.type}" on node ${node.id}`],
  );
}

function edgeErrors(workflow: Workflow): string[] {
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const errors: string[] = [];

  for (const edge of workflow.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      const missing: string[] = [];
      if (!source) missing.push(`source "${edge.source}"`);
      if (!target) missing.push(`target "${edge.target}"`);
      errors.push(`Dangling edge ${edge.id}: ${missing.join(" and ")} does not exist`);
      continue;
    }

    const sourceType = getNodeType(source.type);
    const targetType = getNodeType(target.type);
    if (!sourceType || !targetType) continue;

    const sourceHandle = sourceType.outputs.find((handle) => handle.id === edge.sourceHandle);
    const targetHandle = targetType.inputs.find((handle) => handle.id === edge.targetHandle);
    if (!sourceHandle || !targetHandle) {
      if (!sourceHandle) {
        errors.push(
          `Dangling edge ${edge.id}: handle "${edge.sourceHandle}" is not an output of node ${edge.source}`,
        );
      }
      if (!targetHandle) {
        errors.push(
          `Dangling edge ${edge.id}: handle "${edge.targetHandle}" is not an input of node ${edge.target}`,
        );
      }
      continue;
    }

    if (sourceHandle.type !== targetHandle.type) {
      errors.push(
        `Type mismatch on edge ${edge.id}: output "${sourceHandle.id}" (${sourceHandle.type}) is not compatible with input "${targetHandle.id}" (${targetHandle.type})`,
      );
    }
  }

  return errors;
}

function cycleErrors(workflow: Workflow): string[] {
  const cycle = findCycle(workflow);
  return cycle ? [`Cycle: ${cycle.join(" → ")}`] : [];
}

function findCycle(workflow: Workflow): string[] | undefined {
  const ids = workflow.nodes.map((node) => node.id);
  const present = new Set(ids);
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]));

  for (const edge of workflow.edges) {
    if (!present.has(edge.source) || !present.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
  }

  const color = new Map<string, "white" | "gray" | "black">(ids.map((id) => [id, "white"]));
  const stack: string[] = [];

  const visit = (id: string): string[] | undefined => {
    color.set(id, "gray");
    stack.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const state = color.get(next);
      if (state === "gray") {
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
      if (state === "white") {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, "black");
    return undefined;
  };

  for (const id of ids) {
    if (color.get(id) !== "white") continue;
    const found = visit(id);
    if (found) return found;
  }

  return undefined;
}

function parallelTiers(workflow: Workflow): string[][] {
  const ids = workflow.nodes.map((node) => node.id);
  const position = new Map(ids.map((id, index) => [id, index]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]));

  for (const edge of workflow.edges) {
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  let ready = ids.filter((id) => indegree.get(id) === 0);
  const tiers: string[][] = [];
  let placed = 0;

  while (ready.length > 0) {
    tiers.push(ready);
    const next: string[] = [];
    for (const id of ready) {
      placed += 1;
      for (const target of outgoing.get(id) ?? []) {
        const remaining = (indegree.get(target) ?? 0) - 1;
        indegree.set(target, remaining);
        if (remaining === 0) next.push(target);
      }
    }
    next.sort((left, right) => (position.get(left) ?? 0) - (position.get(right) ?? 0));
    ready = next;
  }

  if (placed !== ids.length) {
    const cycle = findCycle(workflow);
    throw new WorkflowValidationError([
      cycle ? `Cycle: ${cycle.join(" → ")}` : "Cycle: the graph is not acyclic",
    ]);
  }

  return tiers;
}
