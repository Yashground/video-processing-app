import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import useSWR, { mutate } from "swr";
import { Loader2, Plus, RefreshCw, Brain } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Flashcard {
  id: number;
  front: string;
  back: string;
  context: string;
  timestamp: number;
  lastReviewed: string | null;
}

interface FlashcardPanelProps {
  videoId: string | null;
  selectedText?: string;
  currentTimestamp?: number;
}

export default function FlashcardPanel({ videoId, selectedText, currentTimestamp }: FlashcardPanelProps) {
  const [isFlipped, setIsFlipped] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newCard, setNewCard] = useState({
    front: "",
    back: "",
  });
  const { toast } = useToast();

  const { data: flashcards, error, isLoading } = useSWR<Flashcard[]>(
    videoId ? `/api/flashcards/${videoId}` : null
  );

  const handleCreateCard = async () => {
    if (!videoId || !newCard.front || !newCard.back) return;

    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          front: newCard.front,
          back: newCard.back,
          context: selectedText || "",
          timestamp: currentTimestamp || 0,
        }),
      });

      if (!response.ok) throw new Error("Failed to create flashcard");

      setIsCreating(false);
      setNewCard({ front: "", back: "" });
      mutate(`/api/flashcards/${videoId}`);
      
      toast({
        title: "Success",
        description: "Flashcard created successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create flashcard",
        variant: "destructive",
      });
    }
  };

  const handleReview = async (id: number) => {
    try {
      await fetch(`/api/flashcards/${id}/review`, { method: "POST" });
      mutate(`/api/flashcards/${videoId}`);
    } catch (error) {
      console.error("Failed to update review timestamp:", error);
    }
  };

  if (!videoId) {
    return (
      <div className="p-8 text-center text-muted-foreground text-lg">
        Select a video to create and review flashcards
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          Flashcards
        </h3>
        <Dialog open={isCreating} onOpenChange={setIsCreating}>
          <DialogTrigger asChild>
            <Button 
              className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary"
            >
              <Plus className="h-5 w-5 mr-2" />
              Create Flashcard
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Flashcard</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Front</label>
                <Input
                  placeholder="Enter the question or prompt"
                  value={newCard.front}
                  onChange={(e) => setNewCard({ ...newCard, front: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Back</label>
                <Textarea
                  placeholder="Enter the answer or explanation"
                  value={newCard.back}
                  onChange={(e) => setNewCard({ ...newCard, back: e.target.value })}
                />
              </div>
              {selectedText && (
                <div className="p-3 bg-muted rounded-md">
                  <p className="text-sm text-muted-foreground">Context: {selectedText}</p>
                </div>
              )}
              <Button 
                onClick={handleCreateCard}
                className="w-full bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary"
              >
                Create Flashcard
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="h-[400px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center text-destructive">
            Failed to load flashcards
          </div>
        ) : flashcards?.length === 0 ? (
          <div className="text-center text-muted-foreground p-8">
            No flashcards yet. Create one to get started!
          </div>
        ) : (
          <div className="space-y-4">
            {flashcards?.map((card) => (
              <Card
                key={card.id}
                className="p-6 cursor-pointer transition-all duration-300 hover:shadow-md"
                onClick={() => {
                  setIsFlipped(isFlipped === card.id ? null : card.id);
                  if (isFlipped !== card.id) {
                    handleReview(card.id);
                  }
                }}
              >
                <div className="min-h-[100px] relative">
                  <div
                    className={`absolute w-full transition-all duration-300 ${
                      isFlipped === card.id
                        ? "opacity-0 -translate-y-2"
                        : "opacity-100 translate-y-0"
                    }`}
                  >
                    <p className="text-lg font-medium">{card.front}</p>
                  </div>
                  <div
                    className={`absolute w-full transition-all duration-300 ${
                      isFlipped === card.id
                        ? "opacity-100 translate-y-0"
                        : "opacity-0 translate-y-2"
                    }`}
                  >
                    <p className="text-lg">{card.back}</p>
                    {card.context && (
                      <p className="mt-4 text-sm text-muted-foreground">
                        Context: {card.context}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
