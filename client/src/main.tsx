import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Switch, Route, Router, Redirect } from "wouter";
import "./index.css";
import { SWRConfig } from "swr";
import { fetcher } from "./lib/fetcher";
import { Toaster } from "@/components/ui/toaster";
import Home from "./pages/Home";
import { Landing } from "./pages/Landing";
import { useUser } from "@/hooks/use-user";

// Protected Route component to handle authentication
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useUser();
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  if (!user) {
    return <Redirect to="/" />;
  }
  
  return <Component />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SWRConfig value={{ fetcher }}>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/home">
          {() => <ProtectedRoute component={Home} />}
        </Route>
        <Route>404 Page Not Found</Route>
      </Switch>
      <Toaster />
    </SWRConfig>
  </StrictMode>,
);
