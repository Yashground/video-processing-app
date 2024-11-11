import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, AlertCircle, Sparkles, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import useSWRMutation from "swr/mutation";

async function fetchSummary(url: string, { arg }: { arg: { text: string } }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(arg)
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to generate summary');
  }
  
  return response.json();
}

export default function SummaryPanel({ text }: { text: string }) {
  const [summary, setSummary] = useState<string>("");
  
  const { trigger, isMutating, error } = useSWRMutation(
    '/api/summarize',
    fetchSummary,
    {
      onSuccess: (data) => setSummary(data.summary)
    }
  );

  const handleGenerateSummary = async () => {
    if (!text) return;
    try {
      await trigger({ text });
    } catch (error) {
      console.error('Summary generation failed:', error);
    }
  };

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary animate-pulse" />
          Summary
        </h3>
        <Button 
          onClick={handleGenerateSummary} 
          disabled={isMutating || !text}
          size="lg"
          className={`
            min-w-[160px] transition-all duration-300
            bg-gradient-to-r from-primary to-primary/80 
            hover:from-primary/90 hover:to-primary 
            disabled:from-gray-400 disabled:to-gray-500
            group
          `}
        >
          {isMutating ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Generating...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 transition-transform group-hover:scale-110" />
              Generate Summary
            </span>
          )}
        </Button>
      </div>

      <ScrollArea className="h-[300px] rounded-lg border bg-gradient-to-br from-card via-background to-muted transition-all duration-300">
        <div className="p-4">
          {error ? (
            <Alert variant="destructive" className="border-destructive/50 bg-destructive/10 animate-shake">
              <AlertCircle className="h-5 w-5" />
              <AlertTitle className="text-lg font-semibold flex items-center gap-2">
                Summary Generation Failed
              </AlertTitle>
              <AlertDescription className="mt-2 text-base">
                <p className="mb-2">We couldn't generate a summary. This might be because:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>The text might be too long</li>
                  <li>There might be an issue with the AI service</li>
                  <li>The content might need preprocessing</li>
                </ul>
                <Button 
                  onClick={handleGenerateSummary}
                  variant="outline"
                  className="mt-4 w-full border-destructive/50 hover:bg-destructive/10"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Try Again
                </Button>
              </AlertDescription>
            </Alert>
          ) : summary ? (
            <div className="prose prose-lg max-w-none dark:prose-invert animate-fade-in">
              <p className="leading-relaxed whitespace-pre-wrap transition-colors duration-200 hover:text-primary/90">
                {summary}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-8 text-center animate-fade-in">
              <Sparkles className="h-8 w-8 text-primary/50 mb-4" />
              <p className="text-muted-foreground text-lg">
                {text ? 
                  "Click the button above to generate an AI-powered summary of the content." :
                  "Transcribed text will appear here for summarization."
                }
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
