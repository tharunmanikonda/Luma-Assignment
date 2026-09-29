import { signOutAction } from "@/infrastructure/auth/sign-in";
import { requireRolePage } from "@/infrastructure/auth/session";
import { CatalogWorkspace } from "@/modules/catalog/catalog-workspace";
import { listProducts } from "@/modules/catalog/catalog-service";

export default async function OperatorAppPage() {
  const actor = await requireRolePage("operator");
  const initialData = await listProducts({ actor, status: "all" });

  return (
    <>
      <CatalogWorkspace
        actorName={actor.displayName}
        initialData={initialData}
        accountControl={
          <form action={signOutAction}>
            <button className="button secondary" type="submit">
              Sign out
            </button>
          </form>
        }
      />
    </>
  );
}
