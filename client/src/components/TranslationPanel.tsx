import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { translate } from "../lib/translation";

const languages = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" }
];

export default function TranslationPanel() {
  const [sourceText, setSourceText] = useState("");
  const [targetLang, setTargetLang] = useState("en");
  const [translation, setTranslation] = useState("");
  const [loading, setLoading] = useState(false);

  const handleTranslate = async () => {
    if (!sourceText) return;
    
    setLoading(true);
    try {
      const result = await translate(sourceText, targetLang);
      setTranslation(result);
    } catch (error) {
      console.error("Translation failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Translation</h3>
        <Select value={targetLang} onValueChange={setTargetLang}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select language" />
          </SelectTrigger>
          <SelectContent>
            {languages.map((lang) => (
              <SelectItem key={lang.code} value={lang.code}>
                {lang.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Textarea
          placeholder="Click on a subtitle above to translate it..."
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          className="min-h-[100px]"
        />
        <Button onClick={handleTranslate} disabled={loading || !sourceText}>
          {loading ? "Translating..." : "Translate"}
        </Button>
        <Textarea
          value={translation}
          readOnly
          placeholder="Translation will appear here..."
          className="min-h-[100px] bg-muted"
        />
      </div>
    </div>
  );
}
