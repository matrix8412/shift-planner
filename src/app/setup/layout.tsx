import { redirect } from "next/navigation";

import { isSetupRequired } from "@/server/actions/setup";

export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const needsSetup = await isSetupRequired();

  if (!needsSetup) {
    redirect("/login");
  }

  return <>{children}</>;
}
