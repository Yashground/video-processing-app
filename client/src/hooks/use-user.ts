import useSWR from "swr";
import type { User, InsertUser } from "db/schema";

export function useUser() {
  const { data, error, mutate } = useSWR<User, Error>("/api/user", {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
    dedupingInterval: 5000,
    errorRetryCount: 1,
    onError: (error) => {
      // Don't show errors for authentication failures
      if (error.message === "Unauthorized" || error.message === "No session found") {
        return;
      }
      console.error('User data fetch error:', error);
    }
  });

  return {
    user: data,
    isLoading: !error && !data,
    error,
    login: async (user: InsertUser) => {
      try {
        const res = await handleRequest("/login", "POST", user);
        if (res.ok) {
          await mutate();
        }
        return res;
      } catch (error) {
        console.error('Login error:', error);
        return { ok: false, message: "Network error. Please try again." };
      }
    },
    logout: async () => {
      try {
        const res = await handleRequest("/logout", "POST");
        if (res.ok) {
          await mutate(undefined, { revalidate: false });
        }
        return res;
      } catch (error) {
        console.error('Logout error:', error);
        return { ok: false, message: "Network error. Please try again." };
      }
    },
    register: async (user: InsertUser) => {
      try {
        const res = await handleRequest("/register", "POST", user);
        if (res.ok) {
          await mutate();
        }
        return res;
      } catch (error) {
        console.error('Registration error:', error);
        return { ok: false, message: "Network error. Please try again." };
      }
    },
  };
}

type RequestResult =
  | {
      ok: true;
      message?: string;
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

    const data = await response.json();

    if (!response.ok) {
      return { 
        ok: false, 
        message: data.message || "An unexpected error occurred" 
      };
    }

    return { 
      ok: true,
      message: data.message
    };
  } catch (error) {
    console.error('Request error:', error);
    throw error;
  }
}
