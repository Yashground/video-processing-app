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
    <div className="p-4 flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Summary</h3>
        <Button 
          onClick={handleGenerateSummary} 
          disabled={isMutating || !text}
        >
          {isMutating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            'Generate Summary'
          )}
        </Button>
      </div>

      <ScrollArea className="h-[200px] rounded-md border p-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              Failed to generate summary. Please try again.
            </AlertDescription>
          </Alert>
        ) : summary ? (
          <p className="text-foreground whitespace-pre-wrap">{summary}</p>
        ) : (
          <p className="text-muted-foreground">
            Click the button above to generate a summary of the content.
          </p>
        )}
      </ScrollArea>
    </div>
  );
}
