/**
 * Task helpers for the pre-flight check.
 *
 * Providers only expose a generic `generate`, so these assemble the same prompt
 * and schema the registry would use. That means pre-flight exercises the real
 * prompts, not a simplified stand-in.
 */

import type { CropDiagnosis } from '../../shared/types.ts';
import type { IntelligenceProvider } from '../../server/providers/types.ts';
import {
  GEMINI_DIAGNOSIS_SCHEMA,
  parseCropDiagnosis,
} from '../../server/schemas/diagnosis.ts';
import {
  AGRONOMIST_SYSTEM_PROMPT,
  buildDiagnosisPrompt,
} from '../../server/prompts/agronomist.ts';

export async function diagnose(
  provider: IntelligenceProvider,
  image: string,
): Promise<{ data: CropDiagnosis; model: string }> {
  const result = await provider.generate(
    {
      task: 'crop_diagnosis',
      system: AGRONOMIST_SYSTEM_PROMPT,
      prompt: buildDiagnosisPrompt({
        image,
        crop: 'Tomato',
        language: 'en-IN',
        symptoms: 'dark spots spreading on the lower leaves',
      }),
      image,
      schema: GEMINI_DIAGNOSIS_SCHEMA as unknown as Record<string, unknown>,
      maxOutputTokens: 2048,
    },
    AbortSignal.timeout(provider.timeoutMs),
  );

  return { data: parseCropDiagnosis(result.json), model: result.model };
}
