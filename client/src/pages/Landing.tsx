import { useState, useEffect } from "react";
import { useUser } from "@/hooks/use-user";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

// SVG Components
const WavePattern = () => (
  <div className="absolute inset-x-0 bottom-0 h-40 overflow-hidden">
    <svg className="absolute bottom-0 w-full h-full" viewBox="0 0 1440 320" preserveAspectRatio="none">
      <path fill="rgb(230, 243, 255)" fillOpacity="0.4" d="M0,64L40,85.3C80,107,160,149,240,154.7C320,160,400,128,480,112C560,96,640,96,720,112C800,128,880,160,960,165.3C1040,171,1120,149,1200,128C1280,107,1360,85,1400,74.7L1440,64L1440,320L1400,320C1360,320,1280,320,1200,320C1120,320,1040,320,960,320C880,320,800,320,720,320C640,320,560,320,480,320C400,320,320,320,240,320C160,320,80,320,40,320L0,320Z"></path>
      <path fill="rgb(243, 230, 255)" fillOpacity="0.4" d="M0,192L40,181.3C80,171,160,149,240,144C320,139,400,149,480,165.3C560,181,640,203,720,197.3C800,192,880,160,960,144C1040,128,1120,128,1200,133.3C1280,139,1360,149,1400,154.7L1440,160L1440,320L1400,320C1360,320,1280,320,1200,320C1120,320,1040,320,960,320C880,320,800,320,720,320C640,320,560,320,480,320C400,320,320,320,240,320C160,320,80,320,40,320L0,320Z"></path>
    </svg>
  </div>
);

const FloatingShapes = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    <div className="absolute top-20 left-20 w-32 h-32 bg-pastel-blue/30 rounded-full animate-float blur-2xl"></div>
    <div className="absolute top-40 right-20 w-40 h-40 bg-pastel-purple/30 rounded-full animate-float blur-2xl" style={{ animationDelay: '1s' }}></div>
    <div className="absolute bottom-40 left-40 w-36 h-36 bg-pastel-pink/30 rounded-full animate-float blur-2xl" style={{ animationDelay: '2s' }}></div>
  </div>
);

export function Landing() {
  const { login, register, user, isLoading } = useUser();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [, setLocation] = useLocation();

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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-lg font-medium">Loading...</div>
      </div>
    );
  }

  if (user) {
    return null;
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-background to-pastel-mint/20 overflow-hidden">
      <FloatingShapes />
      <div className="container relative mx-auto px-4 py-16 z-10">
        <div className="flex flex-col items-center gap-8">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-primary to-pastel-purple bg-clip-text text-transparent animate-fade-in-up">
            Watch Hour
          </h1>
          <p className="text-xl text-center max-w-2xl text-muted-foreground animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            Transform your video learning experience with AI-powered transcription,
            summaries, and translations. Save time and enhance comprehension with
            our advanced video processing platform.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8 w-full max-w-5xl">
            <div 
              className="space-y-4 p-6 rounded-lg border bg-white/50 backdrop-blur-sm transition-all duration-300 hover:transform hover:-translate-y-1 hover:shadow-lg animate-fade-in-up"
              style={{ animationDelay: '0.4s' }}
            >
              <h2 className="text-2xl font-semibold bg-gradient-to-r from-primary to-pastel-purple bg-clip-text text-transparent">
                Features
              </h2>
              <ul className="space-y-3">
                {[
                  "AI-powered video transcription",
                  "Smart summaries and key points",
                  "Multi-language translation support",
                  "Real-time progress tracking",
                  "Time-saving analytics"
                ].map((feature, index) => (
                  <li 
                    key={index}
                    className="flex items-center space-x-2 transition-all duration-300 hover:translate-x-1"
                  >
                    <span className="text-primary">•</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
            
            <div 
              className="space-y-4 p-6 rounded-lg border bg-white/50 backdrop-blur-sm animate-fade-in-up animate-float"
              style={{ animationDelay: '0.6s' }}
            >
              <h2 className="text-2xl font-semibold bg-gradient-to-r from-primary to-pastel-purple bg-clip-text text-transparent">
                {isLogin ? "Login" : "Register"}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full p-2 rounded-md border bg-white/50 backdrop-blur-sm transition-all duration-300 focus:ring-2 focus:ring-primary/50 focus:border-primary"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-2 rounded-md border bg-white/50 backdrop-blur-sm transition-all duration-300 focus:ring-2 focus:ring-primary/50 focus:border-primary"
                    required
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive animate-fade-in-up">{error}</p>
                )}
                <Button 
                  type="submit" 
                  className="w-full bg-gradient-to-r from-primary to-pastel-purple hover:opacity-90 transition-all duration-300"
                >
                  {isLogin ? "Login" : "Register"}
                </Button>
              </form>
              <p className="text-sm text-center">
                {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-primary hover:text-primary/80 transition-colors duration-300"
                >
                  {isLogin ? "Register" : "Login"}
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
      <WavePattern />
    </div>
  );
}
