import { SignInForm } from "./sign-in-form";

function safeNext(next?: string | string[]) {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  return <SignInForm next={safeNext(params.next)} />;
}
