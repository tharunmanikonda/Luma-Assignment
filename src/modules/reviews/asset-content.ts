import type { QueryResultRow } from "pg";
import { getPool } from "@/db/client";
import { getObjectStore } from "@/infrastructure/storage/local-object-store";
import type { ObjectStore } from "@/infrastructure/storage/object-store";
import type { ReviewActor } from "./domain";
import { ReviewError } from "./errors";

interface AuthorizedAsset extends QueryResultRow {
  objectKey: string;
  mimeType: string | null;
}

export interface AssetAccessStore {
  findAuthorized(
    assetId: string,
    actor: ReviewActor
  ): Promise<AuthorizedAsset | null>;
}

export class PostgresAssetAccessStore implements AssetAccessStore {
  async findAuthorized(assetId: string, actor: ReviewActor) {
    if (actor.role === "operator") {
      const result = await getPool().query<AuthorizedAsset>(
        `select object_key as "objectKey", mime_type as "mimeType"
         from assets
         where id = $1
           and workspace_id = $2
           and status = 'ready'`,
        [assetId, actor.workspaceId]
      );
      return result.rows[0] ?? null;
    }

    const result = await getPool().query<AuthorizedAsset>(
      `select a.object_key as "objectKey", a.mime_type as "mimeType"
       from assets a
       where a.id = $1
         and a.workspace_id = $3
         and a.status = 'ready'
         and a.kind in ('source_image', 'generated_image')
         and exists (
           select 1
           from review_requests rr
           where rr.approver_user_id = $2
             and rr.workspace_id = a.workspace_id
             and (
               rr.source_asset_id = a.id
               or rr.candidate_asset_id = a.id
               or exists (
                 select 1
                 from generation_attempts ga
                 where ga.product_id = rr.product_id
                   and ga.status = 'succeeded'
                   and ga.output_asset_id = a.id
                   and ga.attempt_number < rr.attempt_number
               )
             )
         )`,
      [assetId, actor.id, actor.workspaceId]
    );
    return result.rows[0] ?? null;
  }
}

export class AssetContentService {
  constructor(
    private readonly accessStore: AssetAccessStore,
    private readonly objectStore: ObjectStore
  ) {}

  async read(input: { assetId: string; actor: ReviewActor }) {
    const asset = await this.accessStore.findAuthorized(
      input.assetId,
      input.actor
    );
    if (!asset) throw unavailable();

    const stored = await this.objectStore.get(asset.objectKey);
    if (!stored) throw unavailable();

    return {
      bytes: stored.bytes,
      contentType:
        stored.contentType || asset.mimeType || "application/octet-stream"
    };
  }
}

function unavailable() {
  return new ReviewError("NOT_FOUND", "Asset unavailable.", 404);
}

let service: AssetContentService | undefined;

export function getAssetContentService() {
  service ??= new AssetContentService(
    new PostgresAssetAccessStore(),
    getObjectStore()
  );
  return service;
}
