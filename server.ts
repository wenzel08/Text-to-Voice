import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for Speech Generation
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voice = "Charon", speed = "normal_slow" } = req.body;

      if (!text) {
        res.status(400).json({ error: "Text is required" });
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: "GEMINI_API_KEY environment variable is not configured." });
        return;
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Construct a prompt based on speed and tone
      let speedInstruction = "at a normal pace";
      if (speed === "slow") {
        speedInstruction = "slowly, with distinct phrasing";
      } else if (speed === "normal_slow") {
        speedInstruction = "at a normal-to-slow, relaxed pace";
      } else if (speed === "fast") {
        speedInstruction = "rapidly and dynamically";
      }

      const promptText = `Please read the following text ${speedInstruction}, clearly and professionally:

${text}`;

      console.log(`Generating TTS for text length: ${text.length} using voice: ${voice}, speed: ${speed}`);

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: promptText }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          },
        },
      });

      const candidate = response.candidates?.[0];
      const part = candidate?.content?.parts?.[0];
      const base64Audio = part?.inlineData?.data;

      if (!base64Audio) {
        console.error("No audio data returned in response parts:", JSON.stringify(response));
        res.status(500).json({ error: "Failed to generate speech. The model did not return audio data." });
        return;
      }

      res.json({ audio: base64Audio, format: "pcm", sampleRate: 24000 });
    } catch (err: any) {
      console.error("Error in /api/tts:", err);
      
      let errorMessage = "An unexpected error occurred during speech generation.";
      if (err && typeof err === "object") {
        const rawMessage = err.message || "";
        errorMessage = rawMessage;
        // Check if the message contains a stringified JSON object from the SDK
        try {
          if (rawMessage.includes("{")) {
            const jsonPart = rawMessage.substring(rawMessage.indexOf("{"));
            const parsed = JSON.parse(jsonPart);
            if (parsed?.error?.message) {
              errorMessage = parsed.error.message;
            } else if (parsed?.message) {
              errorMessage = parsed.message;
            }
          }
        } catch (pErr) {
          // Fallback to original message
        }
      } else if (typeof err === "string") {
        errorMessage = err;
      }

      res.status(500).json({ error: errorMessage });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
