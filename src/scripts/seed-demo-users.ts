import { eq } from "drizzle-orm";
import { getDb, closeDb } from "@/db/client";
import { accounts, users, workspaces } from "@/db/schema";
import { getEnv } from "@/shared/env";
import { newId } from "@/shared/ids";
import { hashPassword } from "@/infrastructure/auth/password";

async function upsertDemoUser(input: {
  email: string;
  password: string;
  displayName: string;
  role: "operator" | "approver";
  workspaceId: string;
}) {
  const db = getDb();
  const email = input.email.toLowerCase();
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const userId = existing?.id ?? newId("usr");

  if (existing) {
    await db
      .update(users)
      .set({
        name: input.displayName,
        displayName: input.displayName,
        role: input.role,
        workspaceId: input.workspaceId,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));
  } else {
    await db.insert(users).values({
      id: userId,
      name: input.displayName,
      displayName: input.displayName,
      email,
      role: input.role,
      workspaceId: input.workspaceId
    });
  }

  const passwordHash = await hashPassword(input.password);
  await db
    .insert(accounts)
    .values({
      id: newId("usr"),
      accountId: email,
      providerId: "credential",
      userId,
      password: passwordHash,
      passwordHash
    })
    .onConflictDoUpdate({
      target: [accounts.providerId, accounts.accountId],
      set: {
        userId,
        password: passwordHash,
        passwordHash,
        updatedAt: new Date()
      }
    });
}

async function main() {
  const env = getEnv();
  const workspaceId = "ws_demo";

  await getDb()
    .insert(workspaces)
    .values({
      id: workspaceId,
      name: env.DEMO_WORKSPACE_NAME
    })
    .onConflictDoUpdate({
      target: workspaces.id,
      set: { name: env.DEMO_WORKSPACE_NAME }
    });

  await upsertDemoUser({
    email: env.DEMO_MAYA_EMAIL,
    password: env.DEMO_MAYA_PASSWORD,
    displayName: "Maya",
    role: "operator",
    workspaceId
  });

  await upsertDemoUser({
    email: env.DEMO_ELLIE_EMAIL,
    password: env.DEMO_ELLIE_PASSWORD,
    displayName: "Ellie",
    role: "approver",
    workspaceId
  });

  console.log(
    "Seeded demo workspace and accounts. Passwords were not printed."
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Seed failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
