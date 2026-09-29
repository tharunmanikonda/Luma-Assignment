import { and, eq, max } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activityEvents } from "@/db/schema";
import { products, sceneBriefs } from "@/modules/catalog/schema";
import { AppError } from "@/shared/errors";
import { newId } from "@/shared/ids";

type ActorContext = {
  id: string;
  workspaceId: string;
};

export function validateSceneText(value: unknown) {
  if (typeof value !== "string") {
    throw new AppError(
      "VALIDATION_FAILED",
      "Add scene direction.",
      422,
      false,
      {
        scene: "Describe where the product should appear."
      }
    );
  }
  const scene = value.trim().replace(/\s+/g, " ");
  if (scene.length < 8 || scene.length > 1200) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Scene direction must be between 8 and 1,200 characters.",
      422,
      false,
      { scene: "Use 8 to 1,200 characters." }
    );
  }
  return scene;
}

export async function saveSceneBrief(input: {
  actor: ActorContext;
  productId: string;
  scene: unknown;
  basedOnReviewId?: string | null;
}) {
  const scene = validateSceneText(input.scene);
  if (input.basedOnReviewId) {
    throw new AppError(
      "VALIDATION_FAILED",
      "This review is not available for a catalog-only revision.",
      422,
      false,
      { basedOnReviewId: "Choose a changes-requested review for this product." }
    );
  }

  return getDb().transaction(async (tx) => {
    const [product] = await tx
      .select({
        id: products.id,
        currentSceneBriefId: products.currentSceneBriefId
      })
      .from(products)
      .where(
        and(
          eq(products.id, input.productId),
          eq(products.workspaceId, input.actor.workspaceId)
        )
      )
      .for("update")
      .limit(1);
    if (!product) throw new AppError("NOT_FOUND", "Product not found.", 404);

    if (product.currentSceneBriefId) {
      const [current] = await tx
        .select()
        .from(sceneBriefs)
        .where(eq(sceneBriefs.id, product.currentSceneBriefId))
        .limit(1);
      if (current?.text === scene) return { ...current, repeated: true };
    }

    const [latest] = await tx
      .select({ version: max(sceneBriefs.version) })
      .from(sceneBriefs)
      .where(eq(sceneBriefs.productId, product.id));
    const briefId = newId("scene");
    const [brief] = await tx
      .insert(sceneBriefs)
      .values({
        id: briefId,
        productId: product.id,
        version: (latest?.version ?? 0) + 1,
        text: scene,
        source: "maya_edited",
        createdBy: input.actor.id
      })
      .returning();
    await tx
      .update(products)
      .set({ currentSceneBriefId: briefId, updatedAt: new Date() })
      .where(eq(products.id, product.id));
    await tx.insert(activityEvents).values({
      id: newId("event"),
      workspaceId: input.actor.workspaceId,
      productId: product.id,
      actorType: "user",
      actorId: input.actor.id,
      eventType: "scene_brief_saved",
      eventDataJson: { sceneBriefId: briefId, version: brief.version }
    });

    return { ...brief, repeated: false };
  });
}
