import { expect, it } from "vitest";
import { exportWorkflowJson } from "./mcp-headers";
import { exportSwarmArchive } from "./swarm-archive";

it("a workflow that contains an apiKey field exports JSON without that field", () => {
  const dirty = {
    id: "dirty",
    name: "Dirty",
    viewport: { x: 0, y: 0, zoom: 1 },
    budgetTokens: 100,
    token: "tok-root-do-not-export",
    apiKey: "sk-root-do-not-export",
    nodes: [
      {
        id: "tools",
        type: "mcp",
        position: { x: 0, y: 0 },
        data: {
          label: "Tools",
          transport: "stdio",
          headerSecretId: "secret-keep",
          apiKey: "sk-node-do-not-export",
          token: "tok-node-do-not-export",
          password: "pw-do-not-export",
          secret: "sec-do-not-export",
          authorization: "Bearer hidden",
          APIKEY: "sk-upper-do-not-export",
        },
      },
    ],
    edges: [],
  };

  const json = exportWorkflowJson(dirty);
  const parsed: unknown = JSON.parse(json);

  expect(json).not.toContain("sk-root-do-not-export");
  expect(json).not.toContain("sk-node-do-not-export");
  expect(json).not.toContain("sk-upper-do-not-export");
  expect(json).not.toContain("tok-root-do-not-export");
  expect(json).not.toContain("tok-node-do-not-export");
  expect(json).not.toContain("pw-do-not-export");
  expect(json).not.toContain("sec-do-not-export");
  expect(json).not.toContain("Bearer hidden");
  expect(json).toContain("secret-keep");
  expect(json).toContain("budgetTokens");
  expect(parsed).toMatchObject({
    name: "Dirty",
    budgetTokens: 100,
    nodes: [{ data: { label: "Tools", headerSecretId: "secret-keep" } }],
  });

  const archive = Buffer.from(exportSwarmArchive(dirty)).toString("latin1");
  expect(archive).toContain("workflow.json");
  expect(archive).toContain("prompts.json");
  expect(archive).toContain("requiredEnvVars.json");
  expect(archive).toContain("secret-keep");
  expect(archive).not.toContain("sk-root-do-not-export");
  expect(archive).not.toContain("sk-node-do-not-export");
  expect(archive).not.toContain("tok-root-do-not-export");
  expect(archive).not.toContain("Bearer hidden");
});
