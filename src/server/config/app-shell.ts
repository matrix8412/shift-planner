import { db } from "@/server/db/client";

type ShellProfile = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  preferredTheme: string | null;
  preferredLocale: string | null;
};

const fallbackProfile: ShellProfile = {
  id: "",
  name: "Lokálny používateľ",
  firstName: "Lokálny",
  lastName: "používateľ",
  email: "local@pohotovosti.sk",
  avatarUrl: null,
  preferredTheme: null,
  preferredLocale: null,
};

export async function getShellProfile(userId: string): Promise<ShellProfile> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        avatarUrl: true,
        preferredTheme: true,
        preferredLocale: true,
      },
    });

    if (!user) {
      return fallbackProfile;
    }

    return {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      preferredTheme: user.preferredTheme,
      preferredLocale: user.preferredLocale,
    };
  } catch {
    return fallbackProfile;
  }
}
