import { workflowSchema, type Workflow } from "./workflow";

export type BuiltinTemplate = {
  id: string;
  name: string;
  summary: string;
  workflow: Workflow;
};

const roles: readonly { id: string; name: string; summary: string; job: string }[] = [
  {
    id: "architect",
    name: "Architect",
    summary: "Designs the change and hands the plan to the next node.",
    job: "Turn the brief into a design: the parts, the files to touch, and the risks. Leave the implementation to the next node.",
  },
  {
    id: "coder",
    name: "Coder",
    summary: "Implements the plan and hands the result to the next node.",
    job: "Implement the design you were handed. Keep the change small enough for the next node to review.",
  },
  {
    id: "reviewer",
    name: "Reviewer",
    summary: "Reviews the change and hands findings to the next node.",
    job: "Review the change for correctness, missing checks, and risks. Leave a rewrite to the next node unless the brief asks for a fix.",
  },
  {
    id: "qa",
    name: "QA",
    summary: "Writes the checks and hands off what should pass or fail.",
    job: "Write the checks that prove the change works, and name the cases that should fail.",
  },
  {
    id: "product-owner",
    name: "Product Owner",
    summary: "States the user outcome and the acceptance criteria.",
    job: "State the user outcome and the acceptance criteria the next node must meet.",
  },
  {
    id: "project-manager",
    name: "Project Manager",
    summary: "Orders the work, the owners, and what done means.",
    job: "Turn the brief into an ordered plan with owners and a definition of done.",
  },
  {
    id: "researcher",
    name: "Researcher",
    summary: "Collects the facts and separates them from inference.",
    job: "Gather the facts the brief asks for. Separate what you found from what you inferred.",
  },
];

function roleWorkflow(id: string, name: string, job: string): Workflow {
  const systemPrompt = [
    `You are the ${name}.`,
    job,
    "When you finish, call submit_handoff with summary, files, and blockers.",
    "That handoff is the contract the next node receives.",
    "Do not include credentials in the handoff.",
  ].join(" ");
  const taskPrompt = `Read the brief. Do the ${name} job, then hand off with summary, files, and blockers.`;
  return workflowSchema.parse({
    id: `template-${id}`,
    name,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "brief",
        type: "textInput",
        position: { x: 0, y: 80 },
        data: { label: "Brief", text: `Describe the work for the ${name}.` },
      },
      {
        id: "worker",
        type: "agent",
        position: { x: 320, y: 48 },
        data: { label: name, systemPrompt, taskPrompt },
      },
    ],
    edges: [
      {
        id: "brief-to-worker",
        source: "brief",
        sourceHandle: "text",
        target: "worker",
        targetHandle: "text",
      },
    ],
  });
}

export const builtinTemplates: readonly BuiltinTemplate[] = roles.map((role) => ({
  id: role.id,
  name: role.name,
  summary: role.summary,
  workflow: roleWorkflow(role.id, role.name, role.job),
}));

export function workflowFromTemplate(template: BuiltinTemplate, id: string, name: string): Workflow {
  return workflowSchema.parse({
    ...template.workflow,
    id,
    name,
  });
}
