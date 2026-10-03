import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import { getNodeType, nodeTypes } from "@shared/node-registry";
import type { NodeRunStatus } from "@shared/runs";
import { NodeInspector } from "./NodeInspector";
import { Palette } from "./Palette";
import { useRunStore } from "./run-store";
import { WorkflowEdge } from "./WorkflowEdge";
import { WorkflowLibrary } from "./WorkflowLibrary";
import { WorkflowNodeCard } from "./WorkflowNodeCard";
import { useWorkflowStore } from "./workflow-store";

const gridSize = 16;
const nodeDragType = "application/swarmy-node";

const flowNodeTypes: NodeTypes = Object.fromEntries(
  nodeTypes.map((nodeType) => [nodeType.type, WorkflowNodeCard]),
);

const flowEdgeTypes: EdgeTypes = { workflow: WorkflowEdge };

function snapToGrid(value: number): number {
  return Math.round(value / gridSize) * gridSize;
}

function edgeVisual(
  source: NodeRunStatus | undefined,
  target: NodeRunStatus | undefined,
): "idle" | "running" | "failed" {
  if (source === "failed" || target === "failed") {
    return "failed";
  }
  if (source === "running" || target === "running") {
    return "running";
  }
  return "idle";
}

function shortConnectionError(error: string): string {
  return error.replace(/Type mismatch on edge \S+: /g, "");
}

function FlowSurface() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useWorkflowStore((state) => state.workflow.nodes);
  const edges = useWorkflowStore((state) => state.workflow.edges);
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const statusByNode = useRunStore((state) => state.statusByNode);
  const workflowRunning = useRunStore((state) => state.workflowRunning);
  const runBusy = useRunStore((state) => state.activeNodeId !== null) || workflowRunning;
  const connectionError = useWorkflowStore((state) => state.connectionError);
  const addNode = useWorkflowStore((state) => state.addNode);
  const connect = useWorkflowStore((state) => state.connect);
  const moveNode = useWorkflowStore((state) => state.moveNode);
  const selectNode = useWorkflowStore((state) => state.selectNode);
  const setViewport = useWorkflowStore((state) => state.setViewport);
  const initialViewport = useMemo(() => useWorkflowStore.getState().workflow.viewport, []);

  const flowNodes = useMemo<
    Node<{ label: string; status: NodeRunStatus; busy: boolean; workflowRunning: boolean }>[]
  >(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        data: {
          label: node.data.label,
          status: statusByNode[node.id] ?? "idle",
          busy: runBusy,
          workflowRunning,
        },
        selected: node.id === selectedNodeId,
      })),
    [nodes, runBusy, selectedNodeId, statusByNode, workflowRunning],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: "workflow",
        data: { state: edgeVisual(statusByNode[edge.source], statusByNode[edge.target]) },
      })),
    [edges, statusByNode],
  );

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    };

    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer?.getData(nodeDragType) ?? "";
      if (!getNodeType(type)) return;
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(type, { x: snapToGrid(point.x), y: snapToGrid(point.y) });
    };

    element.addEventListener("dragover", onDragOver, true);
    element.addEventListener("drop", onDrop, true);
    return () => {
      element.removeEventListener("dragover", onDragOver, true);
      element.removeEventListener("drop", onDrop, true);
    };
  }, [addNode, screenToFlowPosition]);

  function onNodesChange(changes: NodeChange[]): void {
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        moveNode(change.id, { x: change.position.x, y: change.position.y });
      }
    }
  }

  function onConnect(connection: Connection): void {
    if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
      return;
    }
    connect({
      source: connection.source,
      sourceHandle: connection.sourceHandle,
      target: connection.target,
      targetHandle: connection.targetHandle,
    });
  }

  return (
    <div ref={surfaceRef} data-testid="workflow-canvas" className="relative h-full min-w-0 flex-1">
      {connectionError ? (
        <p
          data-testid="connection-error"
          className="pointer-events-none absolute top-3 left-1/2 z-20 max-w-lg -translate-x-1/2 rounded border border-red-800 bg-red-950 px-3 py-2 text-center text-sm text-red-100"
        >
          {shortConnectionError(connectionError)}
        </p>
      ) : null}
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={flowNodeTypes}
        edgeTypes={flowEdgeTypes}
        defaultViewport={initialViewport}
        snapToGrid
        snapGrid={[gridSize, gridSize]}
        colorMode="dark"
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onMoveEnd={(_event, viewport) => {
          setViewport(viewport);
        }}
        onNodeClick={(_event, node) => {
          selectNode(node.id);
        }}
        onPaneClick={() => {
          selectNode(null);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={gridSize} size={1} color="#52525b" />
        <MiniMap
          pannable
          zoomable
          className="!bg-zinc-900"
          maskColor="rgb(9 9 11 / 0.7)"
          nodeColor={() => "#a1a1aa"}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function WorkflowCanvas() {
  const workflowId = useWorkflowStore((state) => state.workflow.id);
  return (
    <ReactFlowProvider key={workflowId}>
      <FlowSurface />
    </ReactFlowProvider>
  );
}

export function WorkflowEditor() {
  return (
    <WorkflowLibrary>
      <div className="flex min-h-0 flex-1">
        <Palette />
        <WorkflowCanvas />
        <NodeInspector />
      </div>
    </WorkflowLibrary>
  );
}
