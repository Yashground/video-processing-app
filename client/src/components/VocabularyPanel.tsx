import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Book, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface Vocabulary {
  id: number;
  word: string;
  context: string;
  translation?: string;
  timestamp: number;
  language?: string;
}

interface VocabularyPanelProps {
  videoId: string | null;
}

export default function VocabularyPanel({ videoId }: VocabularyPanelProps) {
  const { toast } = useToast();
  const { data: vocabulary, error, isValidating } = useSWR<Vocabulary[]>(
    videoId ? `/api/vocabulary/${videoId}` : null,
    {
      onError: (err) => {
        toast({
          title: "Error",
          description: "Failed to fetch vocabulary list",
          variant: "destructive"
        });
      }
    }
  );

  const formatTimestamp = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  if (!videoId) {
    return (
      <div className="p-8 text-center text-muted-foreground text-lg animate-fade-in">
        Enter a YouTube URL above to extract vocabulary
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center gap-2 mb-6">
        <Book className="h-6 w-6 text-primary" />
        <h3 className="text-xl font-semibold">Vocabulary List</h3>
      </div>

      <ScrollArea className="h-[400px]">
        {isValidating ? (
          <div className="flex items-center justify-center h-32">
            <div className="flex items-center gap-2 text-primary">
              <Loader2 className="h-5 w-5 animate-spin" />
              Extracting vocabulary...
            </div>
          </div>
        ) : error ? (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-5 w-5" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>Failed to load vocabulary list</AlertDescription>
          </Alert>
        ) : vocabulary?.length ? (
          <div className="space-y-4">
            {vocabulary.map((item) => (
              <Card key={item.id} className="p-4 hover:bg-muted/50 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <h4 className="text-lg font-semibold text-primary">{item.word}</h4>
                  <Badge variant="secondary" className="text-xs">
                    {formatTimestamp(item.timestamp)}
                  </Badge>
                </div>
                <p className="text-muted-foreground mb-2">"{item.context}"</p>
                {item.translation && (
                  <p className="text-sm text-muted-foreground italic">
                    Translation: {item.translation}
                  </p>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground">
            <Book className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No vocabulary extracted yet</p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
