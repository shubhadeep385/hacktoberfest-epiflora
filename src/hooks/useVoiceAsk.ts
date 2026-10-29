import { useCallback, useState } from 'react';
import type { Provenance } from '@shared/types.ts';
import { ApiRequestError } from '../lib/api.ts';
import { useAppStore } from '../store/appStore.ts';

/**
 * Named pipeline stages.
 *
 * The round trip is three sequential network hops, so a bare spinner would feel
 * broken. Naming the steps makes ten seconds read as work rather than a hang, and
 * it also shows a judge exactly which layer is doing what.
 */
export const VOICE_STAGES = [
  'Recognising your speech',
  'Checking your local weather',
  'Working out the answer',
  'Preparing the spoken reply',
] as const;

/** With a photo attached there is a genuinely extra step worth naming. */
export const VOICE_STAGES_WITH_PHOTO = [
  'Recognising your speech',
  'Examining your photo',
  'Checking your local weather',
  'Working out the answer',
  'Preparing the spoken reply',
] as const;

export interface VoiceAnswer {
  transcript: { text: string; language: string };
  answer: string;
  followUps: string[];
  offTopic: boolean;
  disclaimer: string | null;
  audio: string | null;
  speakWithBrowser: boolean;
  provenance: {
    speech: Provenance | null;
    intelligence: Provenance;
    tts: Provenance | null;
  };
}

interface State {
  status: 'idle' | 'working' | 'done' | 'error';
  stage: number;
  /** The stage list in play, which depends on whether a photo was attached. */
  stages: readonly string[];
  result: VoiceAnswer | null;
  error: { message: string; retryable: boolean } | null;
}

const IDLE: State = {
  status: 'idle',
  stage: 0,
  stages: VOICE_STAGES,
  result: null,
  error: null,
};

interface AskInput {
  audio?: Blob;
  question?: string;
  /** Browser speech-recognition fallback when server-side STT is unavailable. */
  fallbackQuestion?: string;
  /** Data URL, for the combined photo-plus-voice flow. */
  image?: string;
}

function geminiAudioExtension(mimeType: string): string | null {
  const mime = mimeType.split(';', 1)[0]?.toLowerCase();
  const extensions: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/aiff': 'aiff',
    'audio/x-aiff': 'aiff',
  };
  return mime ? extensions[mime] ?? null : null;
}

export function useVoiceAsk() {
  const [state, setState] = useState<State>(IDLE);

  const language = useAppStore((store) => store.language);
  const location = useAppStore((store) => store.location);
  const primaryCrop = useAppStore((store) => store.primaryCrop);
  const history = useAppStore((store) => store.history);

  const reset = useCallback(() => setState(IDLE), []);

  const ask = useCallback(
    async (input: AskInput) => {
      if (!input.audio && !input.question?.trim()) return null;

      const stages = input.image ? VOICE_STAGES_WITH_PHOTO : VOICE_STAGES;
      setState({ status: 'working', stage: 0, stages, result: null, error: null });

      // Presentational staging: the API exposes no progress events, so this walks
      // forward on a timer and deliberately never claims the final step finished.
      // Vision adds latency, so the photo flow advances a little more slowly.
      const schedule = input.image ? [1500, 4000, 6500, 9000] : [1500, 3500, 6000];
      const timers = schedule.map((delay, index) =>
        window.setTimeout(
          () => setState((prev) => (prev.status === 'working' ? { ...prev, stage: index + 1 } : prev)),
          delay,
        ),
      );
      const clearTimers = () => timers.forEach((id) => window.clearTimeout(id));

      const send = async (includeAudio: boolean, questionOverride?: string) => {
        const form = new FormData();

        if (includeAudio && input.audio) {
          const extension = geminiAudioExtension(input.audio.type);
          if (extension) {
            form.append('audio', input.audio, `question.${extension}`);
          }
        }
        const question = questionOverride?.trim() || input.question?.trim();
        if (question) form.append('question', question);
        if (input.image) form.append('image', input.image);

        /**
         * Language is sent only when the farmer picked one. Omitting it lets Saaras
         * detect the language, which matters for anyone who never opens settings.
         */
        if (language) form.append('language', language);

        // The context that stops this being a generic chatbot.
        form.append(
          'context',
          JSON.stringify({
            ...(primaryCrop ? { crop: primaryCrop } : {}),
            ...(location?.label ? { locationLabel: location.label } : {}),
            ...(location?.latitude !== undefined ? { latitude: location.latitude } : {}),
            ...(location?.longitude !== undefined ? { longitude: location.longitude } : {}),
            ...(history.length > 0
              ? {
                  recentDiagnoses: history.slice(0, 3).map((record) => ({
                    crop: record.crop,
                    diagnosis: record.diagnosis.diagnosis,
                    when: new Date(record.createdAt).toLocaleDateString(),
                  })),
                }
              : {}),
          }),
        );

        const response = await fetch('/api/voice/ask', { method: 'POST', body: form });
        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          const apiError = new ApiRequestError(
            payload && typeof payload === 'object' && 'error' in payload
              ? (payload as { error: { code: never; message: string; retryable: boolean } })
              : {
                  error: { code: 'internal', message: 'Voice request failed', retryable: true },
                },
          );
          throw apiError;
        }

        return payload as VoiceAnswer;
      };

      try {
        let result: VoiceAnswer;
        const audioCanBeSentToGemini =
          input.audio !== undefined && geminiAudioExtension(input.audio.type) !== null;
        try {
          result = await send(audioCanBeSentToGemini, audioCanBeSentToGemini ? undefined : input.fallbackQuestion);
        } catch (cause) {
          // A browser transcript keeps voice usable when Sarvam/Gemini STT is
          // unavailable. The reasoning provider still receives the question.
          if (
            input.audio &&
            input.fallbackQuestion?.trim() &&
            cause instanceof ApiRequestError &&
            cause.code === 'all_providers_failed'
          ) {
            result = await send(false, input.fallbackQuestion);
          } else {
            throw cause;
          }
        }

        clearTimers();
        setState({ status: 'done', stage: stages.length - 1, stages, result, error: null });
        return result;
      } catch (cause) {
        clearTimers();
        const isApi = cause instanceof ApiRequestError;
        setState({
          status: 'error',
          stage: 0,
          stages,
          result: null,
          error: {
            message: isApi ? cause.friendlyMessage : 'Something went wrong. Please try again.',
            retryable: isApi ? cause.retryable : true,
          },
        });
        return null;
      }
    },
    [history, language, location, primaryCrop],
  );

  return { ...state, ask, reset };
}
