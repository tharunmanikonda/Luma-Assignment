export type CatalogWorkflowStatus = "needs_setup" | "ready_to_generate";

export function deriveCatalogStatus(input: {
  sourceStatus: "pending" | "ready" | "failed" | null;
  sceneText: string | null;
}): CatalogWorkflowStatus {
  return input.sourceStatus === "ready" && Boolean(input.sceneText?.trim())
    ? "ready_to_generate"
    : "needs_setup";
}

export const statusLabels: Record<CatalogWorkflowStatus, string> = {
  needs_setup: "Needs setup",
  ready_to_generate: "Ready to generate"
};
