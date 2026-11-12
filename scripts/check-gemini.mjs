import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

// Print only model names/status. Never log SDK errors, URLs, headers, or the key.
const key = process.env.GEMINI_API_KEY?.trim();
if (!key) {
  console.log('GEMINI_API_KEY no configurada');
  process.exitCode = 1;
} else {
  try {
    if (process.argv.includes('--assistant-demo')) {
      const { checkAssistantGemini } =
        await import('./assistant-gemini-demo.mjs');
      await checkAssistantGemini();
      process.exit(0);
    }
    const client = new GoogleGenAI({
      apiKey: key,
      httpOptions: { timeout: 15000, retryOptions: { attempts: 1 } },
    });
    const freeModels = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite',
    ];
    const pager = await client.models.list({ config: { pageSize: 100 } });
    const available = [];
    for await (const model of pager) {
      const name = model.name?.replace(/^models\//, '');
      if (freeModels.includes(name)) available.push(name);
    }
    const selected =
      process.env.GEMINI_MODEL?.trim() ||
      freeModels.find((name) => available.includes(name));
    console.log(
      JSON.stringify({
        availableFreeCandidates: available,
        selected: selected && freeModels.includes(selected) ? selected : null,
      }),
    );
    if (!selected || !freeModels.includes(selected))
      throw new Error('configuration');
    const response = await client.models.generateContent({
      model: selected,
      contents: 'Responde solo con la palabra OK.',
      config: { maxOutputTokens: 128, temperature: 0 },
    });
    console.log(
      JSON.stringify({
        connection: Boolean(response.text?.trim()),
        model: selected,
      }),
    );
    if (!response.text?.trim()) process.exitCode = 1;
  } catch (error) {
    const status = Number(error?.status) || null;
    console.log(
      JSON.stringify({
        connection: false,
        status,
        reason:
          status === 429
            ? 'quota'
            : status === 401 || status === 403
              ? 'credentials_or_permissions'
              : status === 404
                ? 'model_unavailable'
                : 'network_or_configuration',
      }),
    );
    process.exitCode = 1;
  }
}
