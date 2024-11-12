import useSWR from "swr";
import type { User, InsertUser } from "db/schema";
import { useLocation } from "wouter";

export function useUser() {
  const [, setLocation] = useLocation();
  
  const { data, error, mutate } = useSWR<User>("/api/user", {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
    dedupingInterval: 5000,
    errorRetryCount: 1,
    onError: (error) => {
      // Redirect to landing page for authentication errors
      if (error.status === 401) {
        setLocation("/");
        return;
      }
      console.error('User data fetch error:', error);
    }
  });

  const isLoading = !error && !data;
  const isError = error && error.status !== 401;

  return {
    user: data,
    isLoading,
    isError,
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
          setLocation("/");
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

type RequestResult = {
  ok: boolean;
  message?: string;
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
