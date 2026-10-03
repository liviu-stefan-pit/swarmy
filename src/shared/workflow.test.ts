import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { handleSchema } from "./workflow";
import { nodeTypes } from "./node-registry";
import { validateWorkflow } from "./validate-workflow";

function loadExample(name: string): unknown {
  return JSON.parse(readFileSync(resolve("examples", name), "utf8"));
}

it("orders a diamond into three tiers with the two middle nodes together", () => {
  const result = validateWorkflow(loadExample("valid-line.json"));

  expect(result.tiers).toEqual([["brief"], ["writer", "reviewer"], ["combine"]]);
});

it("names both nodes when the graph contains a cycle", () => {
  expect(() => validateWorkflow(loadExample("cycle.json"))).toThrow(/alpha/);
  expect(() => validateWorkflow(loadExample("cycle.json"))).toThrow(/beta/);
});

it("rejects an edge from a diff output to a file input", () => {
  expect(() => validateWorkflow(loadExample("bad-handle.json"))).toThrow(/type mismatch/i);
  expect(() => validateWorkflow(loadExample("bad-handle.json"))).toThrow(/diff/);
  expect(() => validateWorkflow(loadExample("bad-handle.json"))).toThrow(/file/);
});

it("registers the eight node types and their handles", () => {
  expect(nodeTypes.map((nodeType) => nodeType.type).sort()).toEqual([
    "agent",
    "approval",
    "fileInput",
    "folderInput",
    "mcp",
    "merge",
    "planner",
    "textInput",
  ]);

  for (const nodeType of nodeTypes) {
    for (const handle of [...nodeType.inputs, ...nodeType.outputs]) {
      expect(handleSchema.parse(handle)).toEqual(handle);
    }
  }
});

it("rejects an unknown node type, a dangling edge, and a duplicate id", () => {
  const workflow = validateWorkflow(loadExample("valid-line.json")).workflow;

  expect(() =>
    validateWorkflow({
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === "brief" ? { ...node, type: "not-a-node" } : node,
      ),
    }),
  ).toThrow(/unknown node type/i);

  expect(() =>
    validateWorkflow({
      ...workflow,
      edges: [
        ...workflow.edges,
        {
          id: "missing-target",
          source: "brief",
          sourceHandle: "text",
          target: "missing",
          targetHandle: "text",
        },
      ],
    }),
  ).toThrow(/dangling edge/i);

  expect(() =>
    validateWorkflow({
      ...workflow,
      nodes: [...workflow.nodes, { ...workflow.nodes[0] }],
    }),
  ).toThrow(/duplicate/i);
});
