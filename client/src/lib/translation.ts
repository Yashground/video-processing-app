const LIBRE_TRANSLATE_API = "https://libretranslate.com/translate";

export async function translate(text: string, targetLang: string): Promise<string> {
  try {
    const response = await fetch(LIBRE_TRANSLATE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: text,
        source: "auto",
        target: targetLang,
      }),
    });

    if (!response.ok) {
      throw new Error("Translation request failed");
    }

    const data = await response.json();
    return data.translatedText;
  } catch (error) {
    console.error("Translation error:", error);
    throw error;
  }
}
