import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

export function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={path} />
      <path d={path} fill="none" stroke="transparent" data-testid="canvas-edge" />
    </>
  );
}
