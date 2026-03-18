import { redirect } from "next/navigation";

import { getSessionUserId } from "@/server/auth/session";
import { isSetupRequired } from "@/server/actions/setup";

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const needsSetup = await isSetupRequired();

  if (needsSetup) {
    redirect("/setup");
  }

  const userId = await getSessionUserId();

  if (userId) {
    redirect("/");
  }

  return <>{children}</>;
}
