import { describe, expect, it } from "vitest";
import {
  approvedFilename,
  csvLine,
  deriveWorkflowStatus,
  safeCsvCell
} from "./export-service";

describe("delivery filenames", () => {
  it("uses deterministic SKU and attempt-based approved filenames", () => {
    expect(
      approvedFilename({
        sku: "HG / Tall Vase",
        attemptNumber: 3,
        mimeType: "image/jpeg"
      })
    ).toBe("hg-tall-vase-approved-v3.jpg");
  });
});

describe("catalog CSV safety", () => {
  it("prefixes spreadsheet formulas before quoting", () => {
    expect(safeCsvCell('=IMPORTXML("https://example.test")')).toBe(
      '\'=IMPORTXML("https://example.test")'
    );
    expect(csvLine(["SKU-1", "+SUM(1,2)", "plain"])).toBe(
      `"SKU-1","'+SUM(1,2)","plain"`
    );
  });
});

describe("workflow status projection", () => {
  const base = {
    sourceStatus: "ready" as const,
    sceneText: "Morning counter scene",
    latestAttemptStatus: null,
    latestAttemptHasOutput: false,
    latestAttemptHasReview: false,
    latestReviewState: null,
    approvedCount: 0,
    targetApprovedImages: 2
  };

  it("derives customer workflow states from canonical records", () => {
    expect(deriveWorkflowStatus(base)).toBe("ready_to_generate");
    expect(
      deriveWorkflowStatus({
        ...base,
        latestAttemptStatus: "processing"
      })
    ).toBe("generating");
    expect(
      deriveWorkflowStatus({
        ...base,
        latestAttemptStatus: "succeeded",
        latestAttemptHasOutput: true
      })
    ).toBe("ready_for_maya");
    expect(
      deriveWorkflowStatus({
        ...base,
        latestReviewState: "pending"
      })
    ).toBe("waiting_for_ellie");
    expect(
      deriveWorkflowStatus({
        ...base,
        latestReviewState: "changes_requested"
      })
    ).toBe("changes_requested");
    expect(
      deriveWorkflowStatus({
        ...base,
        approvedCount: 2
      })
    ).toBe("approved");
  });
});
