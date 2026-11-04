import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user?: DefaultSession["user"] & {
      id: string;
      username: string;
    };
  }

  interface User {
    id: string;
    name?: string | null;
    username?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    username?: string;
    /** Epoch ms of the last time the user row was confirmed to still exist. */
    checkedAt?: number;
  }
}
