import { describe, expect, it } from "vitest";
import { AppError } from "@/shared/errors";
import { buildGenerationPrompt } from "./prompt";
import { generationPricing } from "./pricing";
import { GenerationService } from "./service";
import {
  InMemoryGenerationRepository,
  readyProduct
} from "./testing/in-memory-repository";

async function quoted(service: GenerationService) {
  const result = await service.quote(
    "ws_demo",
    "product_1",
    "asset_source",
    "scene_1"
  );
  if (!result.ready) throw new Error("Expected a ready quote.");
  return result.quote;
}

describe("generation authorization", () => {
  it("renders a deterministic versioned preservation prompt", () => {
    expect(buildGenerationPrompt(readyProduct())).toMatchInlineSnapshot(`
      "Task: Edit the supplied product photograph into a styled product image.
      Scene requested by Maya: Morning kitchen counter with warm natural light
      Product facts: Stoneware Vase, Decor, Stoneware, Matte white.
      Preserve: the exact product shape, proportions, material, color, finish, texture, labels, logos, and distinctive details.
      Composition: keep the complete product visible, correctly scaled, and the focal point.
      Avoid: redesigning, recoloring, duplicating, cropping, obscuring, adding text, or adding a watermark to the product."
    `);
  });

  it("returns blockers without creating an attempt", async () => {
    const repository = new InMemoryGenerationRepository(
      readyProduct({ sourceAsset: null })
    );
    const service = new GenerationService(repository, 1_000_000);
    const result = await service.quote(
      "ws_demo",
      "product_1",
      "asset_source",
      "scene_1"
    );
    expect(result).toMatchObject({
      ready: false,
      blockers: [{ code: "SOURCE_REQUIRED" }]
    });
    expect(repository.attempts).toHaveLength(0);
    expect(repository.jobs).toHaveLength(0);
  });

  it("rejects a stale quote after the scene changes", async () => {
    const repository = new InMemoryGenerationRepository(readyProduct());
    const service = new GenerationService(repository, 1_000_000);
    const quote = await quoted(service);
    repository.product.sceneBrief!.text =
      "Holiday mantel with evergreen and candlelight";
    await expect(
      service.authorize({
        workspaceId: "ws_demo",
        productId: "product_1",
        sourceAssetId: "asset_source",
        sceneBriefId: "scene_1",
        pricingVersion: quote.pricingVersion,
        quoteFingerprint: quote.quoteFingerprint,
        idempotencyKey: "confirm-1",
        actorId: "usr_maya"
      })
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("creates one attempt and job for identical confirmation replays", async () => {
    const repository = new InMemoryGenerationRepository(readyProduct());
    const service = new GenerationService(repository, 1_000_000);
    const quote = await quoted(service);
    const input = {
      workspaceId: "ws_demo",
      productId: "product_1",
      sourceAssetId: "asset_source",
      sceneBriefId: "scene_1",
      pricingVersion: quote.pricingVersion,
      quoteFingerprint: quote.quoteFingerprint,
      idempotencyKey: "confirm-1",
      actorId: "usr_maya"
    };
    const first = await service.authorize(input);
    const replay = await service.authorize(input);
    expect(first.created).toBe(true);
    expect(replay).toEqual({ attempt: first.attempt, created: false });
    expect(repository.attempts).toHaveLength(1);
    expect(repository.jobs).toHaveLength(1);
  });

  it("rejects conflicting reuse of an idempotency key", async () => {
    const repository = new InMemoryGenerationRepository(readyProduct());
    const service = new GenerationService(repository, 1_000_000);
    const quote = await quoted(service);
    const base = {
      workspaceId: "ws_demo",
      productId: "product_1",
      sourceAssetId: "asset_source",
      sceneBriefId: "scene_1",
      pricingVersion: quote.pricingVersion,
      quoteFingerprint: quote.quoteFingerprint,
      idempotencyKey: "confirm-1",
      actorId: "usr_maya"
    };
    await service.authorize(base);
    repository.product.sceneBrief!.version = 2;
    repository.product.sceneBrief!.id = "scene_2";
    const nextQuoteResult = await service.quote(
      "ws_demo",
      "product_1",
      "asset_source",
      "scene_2"
    );
    if (!nextQuoteResult.ready) throw new Error("Expected quote");
    await expect(
      service.authorize({
        ...base,
        sceneBriefId: "scene_2",
        quoteFingerprint: nextQuoteResult.quote.quoteFingerprint
      })
    ).rejects.toBeInstanceOf(AppError);
  });

  it("serializes concurrent budget checks", async () => {
    const repository = new InMemoryGenerationRepository(readyProduct());
    const service = new GenerationService(
      repository,
      generationPricing.estimatedPriceMicros
    );
    const quote = await quoted(service);
    const make = (key: string) =>
      service.authorize({
        workspaceId: "ws_demo",
        productId: "product_1",
        sourceAssetId: "asset_source",
        sceneBriefId: "scene_1",
        pricingVersion: quote.pricingVersion,
        quoteFingerprint: quote.quoteFingerprint,
        idempotencyKey: key,
        actorId: "usr_maya"
      });
    const results = await Promise.allSettled([
      make("confirm-a"),
      make("confirm-b")
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(repository.attempts).toHaveLength(1);
  });
});
