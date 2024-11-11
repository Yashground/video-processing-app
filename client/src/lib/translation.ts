import { z } from 'zod';

const translationSchema = z.object({
  text: z.string(),
  targetLanguage: z.string(),
});

export type TranslationRequest = z.infer<typeof translationSchema>;

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, targetLanguage }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Translation failed');
    }

    const data = await response.json();
    return data.translatedText;
  } catch (error) {
    console.error('Translation error:', error);
    throw error;
  }
}
