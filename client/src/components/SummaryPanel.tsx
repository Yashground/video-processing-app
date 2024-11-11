import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
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
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-semibold">Summary</h3>
        <Button 
          onClick={handleGenerateSummary} 
          disabled={isMutating || !text}
          size="lg"
          className="min-w-[160px] transition-all duration-200"
        >
          {isMutating ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Generating...
            </span>
          ) : (
            'Generate Summary'
          )}
        </Button>
      </div>

      <ScrollArea className="h-[300px] rounded-lg border bg-muted/50 transition-all duration-200">
        <div className="p-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle className="text-lg font-semibold">Error</AlertTitle>
              <AlertDescription className="mt-2 text-base">
                Failed to generate summary. Please try again.
              </AlertDescription>
            </Alert>
          ) : summary ? (
            <div className="prose prose-lg max-w-none dark:prose-invert">
              <p className="leading-relaxed whitespace-pre-wrap">{summary}</p>
            </div>
          ) : (
            <p className="text-muted-foreground text-lg text-center py-8">
              {text ? 
                "Click the button above to generate a summary of the content." :
                "Transcribed text will appear here for summarization."
              }
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
