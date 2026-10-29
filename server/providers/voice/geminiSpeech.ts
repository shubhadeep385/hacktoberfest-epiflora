/**
 * Gemini as a speech-to-text fallback.
 *
 * Gemini accepts supported audio containers inline and returns a structured
 * transcript for the agricultural voice pipeline.
 */

import { env } from '../../lib/env.ts';
import { GEMINI_TRANSCRIPT_SCHEMA, transcriptSchema } from '../../schemas/answer.ts';
import { TRANSCRIPTION_SYSTEM_PROMPT, languageName } from '../../prompts/agronomist.ts';
import { GeminiProvider } from '../intelligence/gemini.ts';
import { ProviderError } from '../types.ts';
import { VoiceError, type AudioInput, type SpeechProvider, type TranscriptResult } from './types.ts';

/** Reuses the intelligence provider so the model chain and self-healing apply. */
const gemini = new GeminiProvider();

function toDataUrl(audio: AudioInput): string {
  const supported = new Set([
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/aac',
    'audio/flac',
    'audio/aiff',
    'audio/x-aiff',
  ]);
  if (!supported.has(audio.mimeType)) {
    throw new VoiceError(
      'gemini-stt',
      'unsupported',
      `Gemini does not accept ${audio.mimeType}; record as OGG, MP4, WAV, MP3, AAC, FLAC, or AIFF`,
    );
  }
  const base64 = Buffer.from(audio.bytes).toString('base64');
  return `data:${audio.mimeType};base64,${base64}`;
}

export class GeminiSpeechProvider implements SpeechProvider {
  readonly id = 'gemini-stt';
  readonly timeoutMs = 30_000;

  get label(): string {
    return 'Gemini audio';
  }

  isConfigured(): boolean {
    return Boolean(env.intelligence.geminiApiKey);
  }

  async transcribe(
    audio: AudioInput,
    language: string | undefined,
    signal: AbortSignal,
  ): Promise<TranscriptResult> {
    const languageHint = language
      ? `The speaker is most likely speaking ${languageName(language)}.`
      : 'The speaker may be using any Indian language, or a mix with English.';

    try {
      const result = await gemini.generate(
        {
          task: 'transcription',
          system: TRANSCRIPTION_SYSTEM_PROMPT,
          prompt: `Transcribe the attached recording. ${languageHint}`,
          audio: toDataUrl(audio),
          schema: GEMINI_TRANSCRIPT_SCHEMA as unknown as Record<string, unknown>,
          maxOutputTokens: 1024,
        },
        signal,
      );

      const parsed = transcriptSchema.parse(result.json);
      if (parsed.transcript.length === 0) {
        throw new VoiceError(this.id, 'no_speech', 'No speech detected in the recording');
      }

      return {
        text: parsed.transcript,
        language: language ?? parsed.languageCode,
        languageProbability: language ? null : parsed.confidence,
        model: result.model,
      };
    } catch (cause) {
      if (cause instanceof VoiceError) throw cause;

      // Translate intelligence-layer failures into voice-layer vocabulary so the
      // voice registry can make its own demotion decisions.
      if (cause instanceof ProviderError) {
        const kind =
          cause.kind === 'quota'
            ? 'quota'
            : cause.kind === 'rate_limited'
              ? 'rate_limited'
              : 'unavailable';
        throw new VoiceError(this.id, kind, cause.message, { cause });
      }

      throw new VoiceError(this.id, 'unavailable', String(cause), { cause });
    }
  }
}
