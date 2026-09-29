import { describe, expect, it } from "vitest";
import { FakeLumaGateway } from "@/infrastructure/luma/fake-luma-gateway";
import type {
  ObjectStore,
  StoredObject
} from "@/infrastructure/storage/object-store";
import { GenerationService } from "./service";
import {
  InMemoryGenerationRepository,
  readyProduct
} from "./testing/in-memory-repository";
import { GenerationWorker } from "./worker";

class MemoryObjectStore implements ObjectStore {
  objects = new Map<string, StoredObject>();
  async put(input: StoredObject) {
    this.objects.set(input.key, input);
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async signedReadUrl(key: string) {
    return `memory://${key}`;
  }
}

async function setup(
  scenario: ConstructorParameters<typeof FakeLumaGateway>[0] = "success"
) {
  const repository = new InMemoryGenerationRepository(readyProduct());
  const service = new GenerationService(repository, 1_000_000);
  const quoted = await service.quote(
    "ws_demo",
    "product_1",
    "asset_source",
    "scene_1"
  );
  if (!quoted.ready) throw new Error("Expected quote");
  const authorized = await service.authorize({
    workspaceId: "ws_demo",
    productId: "product_1",
    sourceAssetId: "asset_source",
    sceneBriefId: "scene_1",
    pricingVersion: quoted.quote.pricingVersion,
    quoteFingerprint: quoted.quote.quoteFingerprint,
    idempotencyKey: "confirm-1",
    actorId: "usr_maya"
  });
  const gateway = new FakeLumaGateway(scenario);
  const store = new MemoryObjectStore();
  return {
    repository,
    gateway,
    store,
    worker: new GenerationWorker(repository, gateway, store),
    attempt: authorized.attempt
  };
}

describe("generation worker", () => {
  it("submits once, polls, persists output, then marks success", async () => {
    const { worker, repository, gateway, store, attempt } = await setup();
    await worker.submit(attempt.id);
    await worker.submit(attempt.id);
    expect(gateway.submissions).toHaveLength(1);
    await worker.poll(attempt.id, 0);
    await worker.poll(attempt.id, 1);
    expect((await repository.getAttempt(attempt.id))?.status).toBe("storing");
    await worker.persist(attempt.id);
    const complete = await repository.getAttempt(attempt.id);
    expect(complete).toMatchObject({
      status: "succeeded",
      providerOutputUrl: null,
      outputAssetId: "asset_1"
    });
    expect(store.objects.size).toBe(1);
  });

  it("never resubmits an unknown provider acceptance", async () => {
    const { worker, repository, gateway, attempt } =
      await setup("unknown_submission");
    await worker.submit(attempt.id);
    await worker.submit(attempt.id);
    expect(gateway.submissions).toHaveLength(1);
    expect((await repository.getAttempt(attempt.id))?.status).toBe(
      "reconciliation_required"
    );
  });

  it("reschedules an explicit pre-acceptance rate limit", async () => {
    const { worker, repository, attempt } = await setup("rate_limited");
    await expect(worker.submit(attempt.id)).resolves.toMatchObject({
      action: "reschedule",
      delayMs: 2000
    });
    expect((await repository.getAttempt(attempt.id))?.status).toBe("pending");
  });

  it("records an accepted asynchronous failure without a replacement attempt", async () => {
    const { worker, repository, attempt } = await setup("accepted_failure");
    await worker.submit(attempt.id);
    await worker.poll(attempt.id, 0);
    expect((await repository.getAttempt(attempt.id))?.status).toBe("failed");
    expect(repository.attempts).toHaveLength(1);
  });

  it("keeps output in storing and retries persistence without regenerating", async () => {
    const { worker, repository, gateway, attempt } = await setup(
      "output_download_failure"
    );
    await worker.submit(attempt.id);
    await worker.poll(attempt.id, 0);
    await worker.poll(attempt.id, 1);
    await expect(worker.persist(attempt.id)).resolves.toMatchObject({
      action: "reschedule"
    });
    expect((await repository.getAttempt(attempt.id))?.status).toBe("storing");
    expect(gateway.submissions).toHaveLength(1);
  });

  it("refreshes an expired output URL without resubmitting", async () => {
    const { worker, repository, gateway, store, attempt } = await setup(
      "expired_output_refresh"
    );
    await worker.submit(attempt.id);
    await worker.poll(attempt.id, 0);
    await worker.poll(attempt.id, 1);
    expect(
      (await repository.getAttempt(attempt.id))?.providerOutputUrl
    ).toMatch(/\/expired$/);

    await worker.persist(attempt.id);

    expect(await repository.getAttempt(attempt.id)).toMatchObject({
      status: "succeeded",
      providerOutputUrl: null,
      outputAssetId: "asset_1"
    });
    expect(gateway.polls).toHaveLength(3);
    expect(gateway.submissions).toHaveLength(1);
    expect(gateway.downloads).toEqual([
      `fake-output://fake_${attempt.id}/expired`,
      `fake-output://fake_${attempt.id}/fresh`
    ]);
    expect(store.objects.size).toBe(1);
  });
});
