import { getExistingRoles } from "@/server/actions/setup";

import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const existingRoles = await getExistingRoles();

  return <SetupForm existingRoles={existingRoles} />;
}
