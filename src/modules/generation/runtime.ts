import { getEnv } from "@/shared/env";
import { PostgresGenerationRepository } from "./postgres-repository";
import { GenerationService } from "./service";

const repository = new PostgresGenerationRepository();
const service = new GenerationService(
  repository,
  getEnv().DEMO_GENERATION_BUDGET_CENTS * 10_000
);

export function getGenerationRepository() {
  return repository;
}

export function getGenerationService() {
  return service;
}
