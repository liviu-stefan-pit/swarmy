import { getBezierPath, type EdgeProps } from "@xyflow/react";

type EdgeState = "idle" | "running" | "failed";

function edgeState(data: unknown): EdgeState {
  if (typeof data === "object" && data !== null && "state" in data) {
    const state = data.state;
    if (state === "running" || state === "failed" || state === "idle") {
      return state;
    }
  }
  return "idle";
}

export function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const state = edgeState(data);
  const stroke = state === "failed" ? "#f87171" : state === "running" ? "#38bdf8" : "#a1a1aa";

  return (
    <path
      id={id}
      d={path}
      fill="none"
      stroke={stroke}
      strokeWidth={2}
      className={state === "running" ? "swarmy-edge-running" : undefined}
      data-testid="canvas-edge"
      data-edge-state={state}
    />
  );
}
