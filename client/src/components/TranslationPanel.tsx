import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Globe, Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { translateText } from "@/lib/translation";
import { useToast } from "@/hooks/use-toast";

interface TranslationPanelProps {
  text: string;
}

const SUPPORTED_LANGUAGES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese"
};

const textStyles = {
  container: "px-6 py-4 space-y-4",
  paragraph: "leading-7 tracking-wide text-base text-foreground/90",
  textContainer: "prose prose-zinc dark:prose-invert max-w-none"
};

export default function TranslationPanel({ text }: TranslationPanelProps) {
  const [targetLanguage, setTargetLanguage] = useState<string>("es");
  const [translatedText, setTranslatedText] = useState<string>("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleTranslate = useCallback(async () => {
    if (!text || !targetLanguage) return;

    setIsTranslating(true);
    setError(null);

    try {
      const result = await translateText(text, targetLanguage);
      setTranslatedText(result);
      toast({
        title: "Translation Complete",
        description: `Text has been translated to ${SUPPORTED_LANGUAGES[targetLanguage as keyof typeof SUPPORTED_LANGUAGES]}`,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Translation failed';
      setError(errorMessage);
      toast({
        title: "Translation Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsTranslating(false);
    }
  }, [text, targetLanguage, toast]);

  if (!text) {
    return (
      <div className="p-8 text-center text-muted-foreground text-lg">
        Enter a YouTube URL above to extract audio and translate the content
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-semibold">Translation</h3>
        </div>
        <div className="flex items-center gap-4">
          <Select
            value={targetLanguage}
            onValueChange={setTargetLanguage}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => (
                <SelectItem key={code} value={code}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleTranslate}
            disabled={isTranslating || !text}
            className="min-w-[120px] bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary"
          >
            {isTranslating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Translating...
              </>
            ) : (
              "Translate"
            )}
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[300px] rounded-lg border bg-card">
        {error ? (
          <Alert variant="destructive" className="m-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Translation Failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : translatedText ? (
          <div className={textStyles.container}>
            <div className={textStyles.textContainer}>
              {translatedText.split('\n\n').map((paragraph, index) => (
                <p key={index} className={textStyles.paragraph}>
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            Select a target language and click Translate to begin
          </div>
        )}
      </ScrollArea>
    </div>
  );
}