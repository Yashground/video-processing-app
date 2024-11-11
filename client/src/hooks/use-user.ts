import useSWR from "swr";
import type { User, InsertUser } from "db/schema";

export function useUser() {
  const { data, error, mutate } = useSWR<User, Error>("/api/user", {
    revalidateOnFocus: false,
  });

  return {
    user: data,
    isLoading: !error && !data,
    error,
    login: async (user: InsertUser) => {
      const res = await handleRequest("/login", "POST", user);
      mutate();
      return res;
    },
    logout: async () => {
      const res = await handleRequest("/logout", "POST");
      mutate(undefined);
      return res;
    },
    register: async (user: InsertUser) => {
      const res = await handleRequest("/register", "POST", user);
      mutate();
      return res;
    },
  };
}

type RequestResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      message: string;
    };

async function handleRequest(
  url: string,
  method: string,
  body?: InsertUser
): Promise<RequestResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
    });

    if (!response.ok) {
      const errorData = await response.json();
      return { ok: false, message: errorData.message };
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, message: e.toString() };
  }
}
