import { db } from "@/server/db/client";

type ShellProfile = {
  name: string;
  email: string;
};

const fallbackProfile: ShellProfile = {
  name: "Lokálny používateľ",
  email: "local@pohotovosti.sk",
};

export async function getShellProfile(): Promise<ShellProfile> {
  try {
    const user = await db.user.findFirst({
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        firstName: true,
        lastName: true,
        email: true,
      },
    });

    if (!user) {
      return fallbackProfile;
    }

    return {
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
    };
  } catch {
    return fallbackProfile;
  }
}
