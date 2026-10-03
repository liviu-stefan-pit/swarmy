import {
  handleSchema,
  nodeTypeIdSchema,
  type Handle,
  type HandleDataType,
  type NodeTypeId,
} from "./workflow";

export type NodeTypeDefinition = {
  type: NodeTypeId;
  label: string;
  description: string;
  inputs: Handle[];
  outputs: Handle[];
};

type HandleSpec = {
  id: string;
  type: HandleDataType;
  label: string;
};

function handles(direction: "input" | "output", specs: readonly HandleSpec[]): Handle[] {
  return specs.map((spec) =>
    handleSchema.parse({
      id: spec.id,
      direction,
      type: spec.type,
      label: spec.label,
    }),
  );
}

function defineNode(spec: {
  type: NodeTypeId;
  label: string;
  description: string;
  inputs: readonly HandleSpec[];
  outputs: readonly HandleSpec[];
}): NodeTypeDefinition {
  return {
    type: nodeTypeIdSchema.parse(spec.type),
    label: spec.label,
    description: spec.description,
    inputs: handles("input", spec.inputs),
    outputs: handles("output", spec.outputs),
  };
}

export const nodeTypes: readonly NodeTypeDefinition[] = [
  defineNode({
    type: "textInput",
    label: "Text",
    description: "A short piece of text the rest of the graph can read.",
    inputs: [],
    outputs: [{ id: "text", type: "text", label: "Text" }],
  }),
  defineNode({
    type: "fileInput",
    label: "File",
    description: "One file handed to downstream nodes.",
    inputs: [],
    outputs: [{ id: "file", type: "file", label: "File" }],
  }),
  defineNode({
    type: "folderInput",
    label: "Folder",
    description: "A folder handed to downstream nodes.",
    inputs: [],
    outputs: [{ id: "folder", type: "folder", label: "Folder" }],
  }),
  defineNode({
    type: "mcp",
    label: "MCP",
    description: "An MCP server an agent can use.",
    inputs: [],
    outputs: [{ id: "mcp", type: "mcp", label: "MCP" }],
  }),
  defineNode({
    type: "agent",
    label: "Agent",
    description: "A Cursor agent. It reads text, files, folders, and MCP servers, and it writes a reply and a diff.",
    inputs: [
      { id: "text", type: "text", label: "Text" },
      { id: "file", type: "file", label: "File" },
      { id: "folder", type: "folder", label: "Folder" },
      { id: "mcp", type: "mcp", label: "MCP" },
    ],
    outputs: [
      { id: "text", type: "text", label: "Text" },
      { id: "diff", type: "diff", label: "Diff" },
    ],
  }),
  defineNode({
    type: "planner",
    label: "Planner",
    description: "Turns a brief into a plan other nodes can read.",
    inputs: [{ id: "text", type: "text", label: "Text" }],
    outputs: [{ id: "text", type: "text", label: "Text" }],
  }),
  defineNode({
    type: "approval",
    label: "Approval",
    description: "A person reviews a diff before it continues.",
    inputs: [{ id: "diff", type: "diff", label: "Diff" }],
    outputs: [{ id: "diff", type: "diff", label: "Diff" }],
  }),
  defineNode({
    type: "merge",
    label: "Merge",
    description: "Joins parallel text or diffs into one result.",
    inputs: [
      { id: "text", type: "text", label: "Text" },
      { id: "diff", type: "diff", label: "Diff" },
    ],
    outputs: [
      { id: "text", type: "text", label: "Text" },
      { id: "diff", type: "diff", label: "Diff" },
    ],
  }),
];

const nodeTypesById = new Map<string, NodeTypeDefinition>(
  nodeTypes.map((nodeType) => [nodeType.type, nodeType]),
);

export function getNodeType(type: string): NodeTypeDefinition | undefined {
  return nodeTypesById.get(type);
}
