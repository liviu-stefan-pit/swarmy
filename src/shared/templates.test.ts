import { expect, it } from "vitest";
import { builtinTemplates } from "./templates";
import { validateWorkflow } from "./validate-workflow";
import type { Workflow } from "./workflow";

const templateNames = [
  "Architect",
  "Coder",
  "Reviewer",
  "QA",
  "Product Owner",
  "Project Manager",
  "Researcher",
];

function promptText(workflow: Workflow): string {
  return workflow.nodes
    .map((node) => {
      if (node.type !== "agent" && node.type !== "planner") {
        return "";
      }
      return `${node.data.systemPrompt ?? ""}\n${node.data.taskPrompt ?? ""}`;
    })
    .join("\n");
}

it("every built-in template passes the workflow validator", () => {
  expect(builtinTemplates.map((template) => template.name)).toEqual(templateNames);

  for (const template of builtinTemplates) {
    const validated = validateWorkflow(template.workflow);
    expect(validated.workflow.nodes.length).toBeGreaterThan(0);
    const prompts = promptText(validated.workflow);
    expect(prompts.toLowerCase()).toContain(template.name.toLowerCase());
    expect(prompts.toLowerCase()).toContain("handoff");
  }
});
