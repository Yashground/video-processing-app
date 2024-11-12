import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "default" | "lg";
  text?: string;
}

export function LoadingSpinner({
  size = "default",
  text,
  className,
  ...props
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    default: "h-6 w-6",
    lg: "h-8 w-8"
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-muted-foreground animate-in fade-in-50",
        className
      )}
      {...props}
    >
      <Loader2 className={cn("animate-spin", sizeClasses[size])} />
      {text && (
        <span className={cn(
          "animate-pulse font-medium",
          size === "sm" && "text-sm",
          size === "lg" && "text-lg"
        )}>
          {text}
        </span>
      )}
    </div>
  );
}
