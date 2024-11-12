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
  container: "p-8 space-y-8",
  textContainer: `
    prose 
    prose-zinc 
    dark:prose-invert 
    max-w-none 
    space-y-8
    [&>*]:transition-all
    [&>*]:duration-300
  `,
  paragraph: `
    relative
    group
    mb-8
    leading-[1.8]
    tracking-wide
    text-base
    text-foreground/90
    first-letter:text-xl
    first-letter:font-medium
    first-line:leading-[2]
    indent-[1.5em]
    hover:bg-primary/5
    rounded-lg
    p-8
    transition-all
    duration-300
    border-l-2
    border-transparent
    hover:border-primary/20
    hover:shadow-sm
    hover:translate-x-1
  `,
  section: "rounded-lg bg-card/50 p-8 shadow-sm border border-border/10 backdrop-blur-sm hover:bg-card/60 transition-colors duration-300",
  headingLarge: "text-2xl font-semibold mb-6 text-foreground/90 tracking-tight",
  headingMedium: "text-xl font-medium mb-4 text-foreground/80",
  sectionDivider: "my-8 border-t border-border/40 w-1/3 mx-auto opacity-50",
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
      <div className="p-8 text-center text-muted-foreground">
        <p className="text-lg mb-4">✨ Translate content to any language</p>
        <p className="text-sm text-muted-foreground">
          Enter a YouTube URL above to extract audio and translate the content
        </p>
      </div>
    );
  }

  return (
    <div className={textStyles.container}>
      <div className="flex items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <h2 className={textStyles.headingMedium}>Translation</h2>
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
            className="min-w-[120px] bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary transition-all duration-300"
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

      <ScrollArea className="h-[400px] rounded-lg border bg-background/50 backdrop-blur-sm">
        {error ? (
          <div className={textStyles.section}>
            <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="font-semibold">Translation Failed</AlertTitle>
              <AlertDescription className="mt-2">{error}</AlertDescription>
            </Alert>
          </div>
        ) : translatedText ? (
          <div className={textStyles.container}>
            <div className={textStyles.textContainer}>
              {translatedText.split('\n\n').map((paragraph, index) => (
                <div key={index} className={textStyles.paragraph}>
                  {paragraph}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            <p className="text-lg mb-2">Select a target language and click Translate</p>
            <p className="text-sm text-muted-foreground">
              The translated text will appear here
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}