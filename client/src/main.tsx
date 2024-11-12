import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Switch, Route, Router, Redirect } from "wouter";
import "./index.css";
import { SWRConfig } from "swr";
import { fetcher } from "./lib/fetcher";
import { Toaster } from "@/components/ui/toaster";
import { Loader2 } from "lucide-react";
import Home from "./pages/Home";
import { Landing } from "./pages/Landing";
import { useUser } from "@/hooks/use-user";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useUser();
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-lg font-medium animate-pulse">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }
  
  if (!user) {
    return <Redirect to="/" />;
  }
  
  return <Component />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SWRConfig 
      value={{ 
        fetcher,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        shouldRetryOnError: false,
        onError: (error) => {
          if (error.status === 401) {
            window.location.href = "/";
          }
        }
      }}
    >
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/home">
          {() => <ProtectedRoute component={Home} />}
        </Route>
        <Route>
          <div className="min-h-screen bg-background flex items-center justify-center">
            <div className="text-lg font-medium">404 Page Not Found</div>
          </div>
        </Route>
      </Switch>
      <Toaster />
    </SWRConfig>
  </StrictMode>
);
