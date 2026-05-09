import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { NextApiRequest, NextApiResponse } from "next";

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY || "",
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text, voiceId = "JBFqnCBsd6RMkjVDRZzb" } = req.body; // Default: George

  if (!text) {
    return res.status(400).json({ error: "Missing text payload" });
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(500).json({ error: "ELEVENLABS_API_KEY is not set" });
  }

  try {
    console.log(`[ElevenLabs] Generating TTS for: "${text.slice(0, 30)}..."`);
    const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
      text,
      modelId: "eleven_turbo_v2_5",
      outputFormat: "mp3_44100_128",
    });

    res.setHeader("Content-Type", "audio/mpeg");
    
    // The ElevenLabs JS SDK returns a Node Readable stream in Node.js environments
    audioStream.pipe(res);
  } catch (err: any) {
    console.error("[ElevenLabs] TTS error:", err);
    return res.status(500).json({ error: err?.message ?? "TTS Generation failed" });
  }
}
