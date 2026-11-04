import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { supabase } from "@/lib/supabase";
import { getDummyHash, verifyPassword } from "@/lib/crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http";

const GENERIC_LOGIN_ERROR = "Invalid username or password";
const RATE_LIMIT_ERROR = "Too many sign-in attempts. Please wait a minute and try again.";
/** How often the jwt callback re-checks that the user still exists. */
const REVALIDATE_MS = 5 * 60 * 1000;

const LOGIN_LIMIT_PER_USERNAME = 5;
const LOGIN_LIMIT_PER_IP = 20;
const LOGIN_WINDOW_MS = 60 * 1000;

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const username = typeof credentials?.username === "string" ? credentials.username.trim() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!username || !password || username.length > 255 || password.length > 1024) {
          throw new Error(GENERIC_LOGIN_ERROR);
        }

        const ip = clientIp(req?.headers as Record<string, string | string[] | undefined> | undefined);
        // Shared (DB-backed) limits so attempts are counted across all server instances.
        const [byIp, byUser] = await Promise.all([
          checkRateLimit(`login_ip_${ip}`, LOGIN_LIMIT_PER_IP, LOGIN_WINDOW_MS),
          checkRateLimit(`login_user_${username.toLowerCase()}`, LOGIN_LIMIT_PER_USERNAME, LOGIN_WINDOW_MS),
        ]);
        if (!byIp.success || !byUser.success) {
          throw new Error(RATE_LIMIT_ERROR);
        }

        const { data: user, error } = await supabase
          .from("users")
          .select("id, username, password_hash")
          .eq("username", username)
          .maybeSingle();

        if (error) {
          console.error("[auth] user lookup failed:", error);
          throw new Error(GENERIC_LOGIN_ERROR);
        }

        // Always run scrypt so timing does not reveal whether the username exists.
        const hash = user?.password_hash ?? (await getDummyHash());
        const valid = await verifyPassword(password, hash);
        if (!user || !valid) {
          throw new Error(GENERIC_LOGIN_ERROR);
        }

        return { id: user.id as string, name: user.username as string, username: user.username as string };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = user.username ?? user.name ?? "";
        token.checkedAt = Date.now();
        return token;
      }
      if (!token.id) return token;

      const now = Date.now();
      if (!token.checkedAt || now - token.checkedAt > REVALIDATE_MS) {
        const { data, error } = await supabase.from("users").select("id, username").eq("id", token.id).maybeSingle();
        if (error) {
          // Transient DB failure: keep the session, try again on the next request.
          console.error("[auth] session revalidation failed:", error);
          return token;
        }
        if (!data) {
          // Throwing here makes NextAuth clear the session cookie (session revoked).
          throw new Error("Session revoked: user no longer exists");
        }
        token.username = data.username as string;
        token.checkedAt = now;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) {
        session.user = {
          ...session.user,
          id: token.id,
          username: token.username ?? "",
          name: token.username ?? session.user?.name ?? null,
        };
      } else {
        delete session.user;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
