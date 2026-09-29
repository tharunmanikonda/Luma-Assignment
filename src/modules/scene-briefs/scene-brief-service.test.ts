import { describe, expect, it } from "vitest";
import { AppError } from "@/shared/errors";
import { validateSceneText } from "./scene-brief-service";

describe("scene direction validation", () => {
  it("normalizes meaningful customer language", () => {
    expect(validateSceneText("  morning   kitchen counter, warm light  ")).toBe(
      "morning kitchen counter, warm light"
    );
  });

  it("returns a field error for empty or excessive drafts", () => {
    for (const value of ["short", "x".repeat(1201)]) {
      try {
        validateSceneText(value);
        throw new Error("Expected validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).fieldErrors?.scene).toBeTruthy();
      }
    }
  });
});
