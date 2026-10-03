import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SettingsForm } from "./SettingsForm";

it("never puts the API key into the workflow state object", () => {
  const secret = "cursor_test_key_do_not_store";
  const workflow: { name: string; apiKey?: string } = { name: "Untitled" };
  const onSaveKey = vi.fn();
  let published: { name: string; apiKey?: string } | undefined;

  render(
    <SettingsForm
      workflow={workflow}
      onSaveKey={onSaveKey}
      onWorkflowChange={(next) => {
        published = next;
      }}
    />,
  );

  fireEvent.change(screen.getByLabelText("API key"), { target: { value: secret } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(onSaveKey).toHaveBeenCalledWith(secret);
  expect(JSON.stringify(workflow)).not.toContain(secret);
  expect(workflow).not.toHaveProperty("apiKey");
  if (published) {
    expect(JSON.stringify(published)).not.toContain(secret);
    expect(published).not.toHaveProperty("apiKey");
  }
});
