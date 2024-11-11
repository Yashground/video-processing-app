import { useState, useEffect } from "react";
import { useUser } from "@/hooks/use-user";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export function Landing() {
  const { login, register, user, isLoading } = useUser();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [, setLocation] = useLocation();

  // Redirect to /home if user is already authenticated
  useEffect(() => {
    if (user && !isLoading) {
      setLocation("/home");
    }
  }, [user, isLoading, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    const result = await (isLogin ? login : register)({ username, password });
    if (!result.ok) {
      setError(result.message);
    } else {
      setLocation("/home");
    }
  };

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  // Don't render the landing page if user is authenticated
  if (user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="flex flex-col items-center gap-8">
          <h1 className="text-4xl font-bold text-primary">Watch Hour</h1>
          <p className="text-xl text-center max-w-2xl text-muted-foreground">
            Transform your video learning experience with AI-powered transcription,
            summaries, and translations. Save time and enhance comprehension with
            our advanced video processing platform.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
            <div className="space-y-4 p-6 rounded-lg border bg-card">
              <h2 className="text-2xl font-semibold">Features</h2>
              <ul className="space-y-2">
                <li>• AI-powered video transcription</li>
                <li>• Smart summaries and key points</li>
                <li>• Multi-language translation support</li>
                <li>• Real-time progress tracking</li>
                <li>• Time-saving analytics</li>
              </ul>
            </div>
            
            <div className="space-y-4 p-6 rounded-lg border bg-card">
              <h2 className="text-2xl font-semibold">
                {isLogin ? "Login" : "Register"}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full p-2 rounded-md border bg-background"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-2 rounded-md border bg-background"
                    required
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
                <Button type="submit" className="w-full">
                  {isLogin ? "Login" : "Register"}
                </Button>
              </form>
              <p className="text-sm text-center">
                {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-primary hover:underline"
                >
                  {isLogin ? "Register" : "Login"}
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
