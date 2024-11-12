import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Switch, Route, Router, Redirect } from "wouter";
import "./index.css";
import { SWRConfig } from "swr";
import { fetcher } from "./lib/fetcher";
import { Toaster } from "@/components/ui/toaster";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Home from "./pages/Home";
import { Landing } from "./pages/Landing";
import { useUser } from "@/hooks/use-user";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading, isError } = useUser();
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center animate-in fade-in-50 duration-500">
        <LoadingSpinner size="lg" text="Loading your profile..." />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center animate-in fade-in-50 duration-500">
        <div className="text-destructive">Failed to load user profile. Please try again.</div>
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
    <ErrorBoundary>
      <SWRConfig 
        value={{ 
          fetcher,
          revalidateOnFocus: false,
          revalidateOnReconnect: false,
          shouldRetryOnError: false
        }}
      >
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/home">
            {() => <ProtectedRoute component={Home} />}
          </Route>
          <Route>
            <div className="min-h-screen bg-background flex items-center justify-center animate-in fade-in-50 duration-500">
              <div className="text-lg font-medium">404 Page Not Found</div>
            </div>
          </Route>
        </Switch>
        <Toaster />
      </SWRConfig>
    </ErrorBoundary>
  </StrictMode>
);

// Handle unhandled rejections globally
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  // Prevent the default handler from running
  event.preventDefault();
});
