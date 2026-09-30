import { redirect } from "next/navigation";
import { roleHomePath } from "@/infrastructure/auth/role-home";
import { getSessionActor } from "@/infrastructure/auth/session";

export default async function HomePage() {
  const actor = await getSessionActor();
  if (!actor) redirect("/sign-in");
  redirect(roleHomePath(actor.role));
}
