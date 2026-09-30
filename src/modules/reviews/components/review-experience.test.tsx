// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewReadModel } from "../domain";
import { ReviewExperience } from "./review-experience";

const pendingReview: ReviewReadModel = {
  id: "review_1",
  state: "pending",
  product: {
    name: "Stoneware Mug",
    sku: "HG-002",
    category: "Drinkware",
    colorFinish: "Speckled white",
    material: "Stoneware"
  },
  candidate: {
    attemptNumber: 2,
    sceneVersion: 2,
    sceneDirection: "Morning counter with soft window light.",
    imageUrl: "/api/assets/candidate/content",
    imageAlt: "Generated image for Stoneware Mug"
  },
  source: {
    imageUrl: "/api/assets/source/content",
    imageAlt: "Original product photo of Stoneware Mug"
  },
  feedback: null,
  createdAt: "2026-09-28T12:00:00.000Z",
  decidedAt: null,
  revokedAt: null,
  canDecide: true,
  historyNextCursor: null,
  history: [
    {
      reviewId: "review_0",
      attemptId: "attempt_1",
      attemptNumber: 1,
      imageUrl: "/api/assets/older/content",
      sceneDirection: "Morning counter with warm light.",
      sceneVersion: 1,
      state: "changes_requested",
      feedback: "Reduce the orange cast.",
      decidedAt: "2026-09-27T12:00:00.000Z",
      createdAt: "2026-09-27T10:00:00.000Z"
    }
  ]
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReviewExperience", () => {
  it("keeps labeled decision controls and source comparison available", () => {
    render(<ReviewExperience review={pendingReview} />);

    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Request changes" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare" })).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "Original product photo of Stoneware Mug"
      })
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Back to inbox" }).getAttribute("href")
    ).toBe("/reviews");
    expect(screen.getByText(/Reduce the orange cast/)).toBeTruthy();
  });

  it("uses an in-app approval confirmation", () => {
    render(<ReviewExperience review={pendingReview} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(
      screen.getByRole("dialog", { name: "Approve this generated image?" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Confirm approval" })
    ).toBeTruthy();
  });

  it("prevents empty change feedback before making a request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ReviewExperience review={pendingReview} />);

    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    expect(
      screen.getByRole("dialog", { name: "What should Maya change?" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(screen.getByRole("alert").textContent).toContain("Add a short note");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders revoked reviews as read-only history", () => {
    render(
      <ReviewExperience
        review={{
          ...pendingReview,
          state: "revoked",
          canDecide: false,
          revokedAt: "2026-09-28T13:00:00.000Z"
        }}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Request revoked" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText(/history remains available/i)).toBeTruthy();
  });

  it("loads the next cursor page of history", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ...pendingReview,
          historyNextCursor: null,
          history: [
            {
              ...pendingReview.history[0],
              reviewId: "review_next",
              attemptId: "attempt_next",
              attemptNumber: 2,
              sceneDirection: "Later history scene."
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    render(
      <ReviewExperience
        review={{ ...pendingReview, historyNextCursor: "next-page" }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more history" }));

    await waitFor(() =>
      expect(screen.getByText("Later history scene.")).toBeTruthy()
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/reviews/review_1?historyCursor=next-page"
    );
    expect(
      screen.queryByRole("button", { name: "Load more history" })
    ).toBeNull();
  });
});
