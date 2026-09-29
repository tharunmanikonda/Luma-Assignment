import type { ProductGenerationInput } from "./domain";

export const promptTemplateVersion = "product-image-edit-v1";

export function buildGenerationPrompt(input: ProductGenerationInput) {
  if (!input.sceneBrief) throw new Error("A scene brief is required.");
  const facts = [
    input.name,
    input.category,
    input.material,
    input.colorFinish
  ].filter((value): value is string => Boolean(value?.trim()));
  return [
    "Task: Edit the supplied product photograph into a styled product image.",
    `Scene requested by Maya: ${input.sceneBrief.text.trim()}`,
    `Product facts: ${facts.join(", ")}.`,
    "Preserve: the exact product shape, proportions, material, color, finish, texture, labels, logos, and distinctive details.",
    "Composition: keep the complete product visible, correctly scaled, and the focal point.",
    "Avoid: redesigning, recoloring, duplicating, cropping, obscuring, adding text, or adding a watermark to the product."
  ].join("\n");
}
