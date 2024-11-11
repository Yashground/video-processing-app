import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import SubtitleViewer from "../components/SubtitleViewer";
import SummaryPanel from "../components/SummaryPanel";
import FlashcardPanel from "../components/FlashcardPanel";
import HistorySidebar from "../components/HistorySidebar";
import { useToast } from "@/hooks/use-toast";
import { Youtube } from "lucide-react";

const urlSchema = z.object({
  videoUrl: z.string().url().refine((url) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "youtu.be") {
        return parsed.pathname.length > 1;
      }
      if (parsed.hostname === "youtube.com" || parsed.hostname === "www.youtube.com") {
        return !!parsed.searchParams.get("v");
      }
      return false;
    } catch {
      return false;
    }
  }, "Please enter a valid YouTube URL")
});

export default function Home() {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [transcribedText, setTranscribedText] = useState<string>("");
  const [selectedText, setSelectedText] = useState<string>("");
  const { toast } = useToast();
  
  const form = useForm<z.infer<typeof urlSchema>>({
    resolver: zodResolver(urlSchema),
    defaultValues: {
      videoUrl: ""
    }
  });

  const onSubmit = (data: z.infer<typeof urlSchema>) => {
    try {
      const url = new URL(data.videoUrl);
      let id: string | null = null;

      if (url.hostname === "youtu.be") {
        id = url.pathname.slice(1);
      } else {
        id = url.searchParams.get("v");
      }

      if (id) {
        setVideoId(id);
        setTranscribedText("");
        setSelectedText("");
      } else {
        toast({
          title: "Invalid URL",
          description: "Could not extract video ID from the URL",
          variant: "destructive"
        });
      }
    } catch (e) {
      toast({
        title: "Error",
        description: "Failed to parse video URL",
        variant: "destructive"
      });
    }
  };

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      setSelectedText(selection.toString().trim());
    }
  };

  return (
    <div className="flex h-screen">
      <HistorySidebar 
        onVideoSelect={setVideoId} 
        selectedVideoId={videoId}
        className="hidden md:block"
      />
      <div className="flex-1 overflow-auto">
        <div className="container py-12 px-4 space-y-8 animate-fade-in">
          <Card className="p-8 shadow-lg bg-gradient-to-br from-background via-background to-muted transition-all duration-300 hover:shadow-xl">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex gap-4">
                <FormField
                  control={form.control}
                  name="videoUrl"
                  render={({ field }) => (
                    <FormItem className="flex-1 relative">
                      <FormControl>
                        <div className="relative">
                          <Youtube className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                          <Input 
                            placeholder="Enter YouTube URL (e.g., youtube.com/watch?v=... or youtu.be/...)" 
                            className="h-12 pl-11 pr-4 transition-all duration-200 border-2 hover:border-primary/50 focus:border-primary"
                            {...field} 
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button 
                  type="submit" 
                  size="lg"
                  className="h-12 px-8 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary transition-all duration-300 shadow-lg hover:shadow-xl"
                >
                  Process Audio
                </Button>
              </form>
            </Form>
          </Card>

          <div className="space-y-8">
            <Card className="shadow-lg overflow-hidden bg-gradient-to-br from-card via-background to-muted transition-all duration-300 hover:shadow-xl">
              <div onMouseUp={handleTextSelection}>
                <SubtitleViewer 
                  videoId={videoId} 
                  onTextUpdate={setTranscribedText}
                />
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <Card className="shadow-lg overflow-hidden bg-gradient-to-br from-card via-background to-muted transition-all duration-300 hover:shadow-xl">
                <SummaryPanel text={transcribedText} />
              </Card>

              <Card className="shadow-lg overflow-hidden bg-gradient-to-br from-card via-background to-muted transition-all duration-300 hover:shadow-xl">
                <FlashcardPanel 
                  videoId={videoId}
                  selectedText={selectedText}
                />
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
