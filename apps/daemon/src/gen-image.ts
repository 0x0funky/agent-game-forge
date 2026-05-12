/**
 * Image-gen router — calls OpenAI / Gemini on the user's behalf so agents
 * without built-in image_gen (Claude Code, future Gemini CLI, etc) can
 * still drive the OGF visual pipeline.
 *
 * Architecture:
 *   - Daemon owns API keys (resolveSecret from ~/.ogf/secrets.json or env).
 *   - Web / shell wrapper POSTs { prompt, outputPath, ... } to /api/gen-image.
 *   - Router picks provider (explicit or auto: Gemini preferred, OpenAI fallback).
 *   - Provider client calls the actual API, decodes the PNG, writes to disk.
 *   - Response: { path, provider, sizeBytes }.
 *
 * Codex CLI users keep using Codex's built-in `image_gen` — this endpoint
 * is an alternate path, not a replacement.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveSecret } from './secrets.js';

// ---------- Types ----------

export type GenImageProvider = 'gemini' | 'openai';

export interface GenImageRequest {
  /** The image prompt. Required. */
  prompt: string;
  /** Where to save the PNG (absolute path). Required. Parent dirs auto-created. */
  outputPath: string;
  /** Optional reference images for image-to-image (Gemini multimodal, OpenAI edits).
   *  Absolute paths to PNG/JPEG files on disk. */
  refImagePaths?: string[];
  /** Output size. For OpenAI must be one of: "1024x1024", "1024x1536", "1536x1024", "auto".
   *  For Gemini, accepts any reasonable size; the API will best-effort fit. */
  size?: string;
  /** When true (default), append a "solid #FF00FF magenta background" instruction
   *  so the OGF sprite pipeline's chroma-key step works. Set false for backgrounds
   *  / scene art where you want a normal image. */
  magentaBg?: boolean;
  /** Force a specific provider. When omitted, auto-pick (Gemini if keyed, else OpenAI). */
  provider?: GenImageProvider;
  /** Provider-specific model override. Defaults are sensible. */
  model?: string;
}

export interface GenImageResult {
  /** Absolute path the PNG was written to (echoes outputPath). */
  path: string;
  provider: GenImageProvider;
  sizeBytes: number;
  /** Provider model name actually used. */
  model: string;
  /** Optional textual response from the provider (Gemini sometimes returns prose
   *  alongside the image; surfaced for debugging). */
  text?: string;
}

export class GenImageError extends Error {
  constructor(
    message: string,
    public readonly provider: GenImageProvider | 'router',
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'GenImageError';
  }
}

// ---------- Defaults ----------

const DEFAULT_MODEL: Record<GenImageProvider, string> = {
  // GA model that replaced "Nano Banana" preview. Native multimodal,
  // accepts text + up to 14 reference images in a single call.
  gemini: 'gemini-2.5-flash-image',
  // OpenAI's GA image model. Returns b64_json by default; supports
  // text-to-image (/images/generations) and image-edits (/images/edits).
  openai: 'gpt-image-1',
};

const MAGENTA_INSTRUCTION =
  ' Background is 100% solid flat magenta (#FF00FF), no gradients, no shadow, no other colors. ' +
  'The subject is fully visible and centered with even magenta margin on all sides.';

// ---------- Prompt augmentation ----------

function augmentPrompt(prompt: string, magentaBg: boolean | undefined): string {
  // Default is ON — sprite pipeline depends on magenta chroma-key. Pass false
  // explicitly when generating backgrounds, parallax layers, or anything that
  // should look like a normal scene.
  if (magentaBg === false) return prompt;
  // Don't double-add if the caller already mentioned magenta — avoids
  // weighting the instruction twice in the prompt.
  if (/#?FF00FF|magenta\s*background/i.test(prompt)) return prompt;
  return prompt + '\n\n' + MAGENTA_INSTRUCTION;
}

// ---------- Output ----------

function writePng(outputPath: string, bytes: Uint8Array): number {
  const dir = path.dirname(outputPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, bytes);
  return statSync(outputPath).size;
}

function readRefAsBase64(refPath: string): { mimeType: string; data: string } {
  const buf = readFileSync(refPath);
  const ext = path.extname(refPath).toLowerCase();
  const mimeType =
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return { mimeType, data: buf.toString('base64') };
}

// ---------- Gemini ----------

interface GeminiInlineData {
  mimeType: string;
  data: string;
}
interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData; // older snake_case in some examples
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
}

async function callGemini(
  req: GenImageRequest,
  apiKey: string,
  model: string,
): Promise<{ bytes: Uint8Array; text?: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const parts: GeminiPart[] = [{ text: augmentPrompt(req.prompt, req.magentaBg) }];
  for (const ref of req.refImagePaths ?? []) {
    parts.push({ inlineData: readRefAsBase64(ref) });
  }
  const body = {
    contents: [{ parts }],
    generationConfig: {
      // Gemini 2.5 Flash Image returns image data in candidates[].content.parts[].inlineData
      // by default; responseModalities forces the image output.
      responseModalities: ['IMAGE'],
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new GenImageError(
      `Gemini API error ${res.status}`,
      'gemini',
      res.status,
      bodyText,
    );
  }

  const data = (await res.json()) as GeminiResponse;
  if (data.promptFeedback?.blockReason) {
    throw new GenImageError(
      `Gemini blocked: ${data.promptFeedback.blockReason}`,
      'gemini',
    );
  }
  const candidate = data.candidates?.[0];
  const respParts = candidate?.content?.parts ?? [];
  let imageData: GeminiInlineData | undefined;
  let textOut: string | undefined;
  for (const p of respParts) {
    const inline = p.inlineData ?? p.inline_data;
    if (inline?.data && /^image\//.test(inline.mimeType)) {
      imageData = inline;
    } else if (p.text) {
      textOut = (textOut ?? '') + p.text;
    }
  }
  if (!imageData) {
    throw new GenImageError(
      `Gemini returned no image (finishReason=${candidate?.finishReason ?? 'unknown'})`,
      'gemini',
    );
  }
  const bytes = Buffer.from(imageData.data, 'base64');
  return { bytes, text: textOut };
}

// ---------- OpenAI ----------

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
}

async function callOpenAI(
  req: GenImageRequest,
  apiKey: string,
  model: string,
): Promise<{ bytes: Uint8Array }> {
  const prompt = augmentPrompt(req.prompt, req.magentaBg);
  // gpt-image-1 size whitelist; map common "1024" / "1280x720" sloppy inputs.
  const sizeRaw = req.size ?? '1024x1024';
  const allowedSizes = new Set([
    '1024x1024',
    '1024x1536',
    '1536x1024',
    'auto',
  ]);
  const size = allowedSizes.has(sizeRaw) ? sizeRaw : '1024x1024';

  const hasRefs = (req.refImagePaths?.length ?? 0) > 0;
  let res: Response;

  if (!hasRefs) {
    // Text-to-image
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, prompt, size, n: 1 }),
    });
  } else {
    // Image edits — multipart/form-data; first ref is the base image, rest are
    // additional inputs (gpt-image-1 supports multiple via `image[]`).
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('n', '1');
    for (const ref of req.refImagePaths!) {
      const buf = readFileSync(ref);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const blob = new Blob([ab as ArrayBuffer], { type: 'image/png' });
      form.append('image[]', blob, path.basename(ref));
    }
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new GenImageError(
      `OpenAI API error ${res.status}`,
      'openai',
      res.status,
      bodyText,
    );
  }

  const data = (await res.json()) as OpenAIImageResponse;
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    throw new GenImageError(
      `OpenAI returned no image (${data.error?.message ?? 'unknown'})`,
      'openai',
    );
  }
  return { bytes: Buffer.from(b64, 'base64') };
}

// ---------- Router ----------

function pickProvider(explicit?: GenImageProvider): GenImageProvider {
  if (explicit === 'gemini' || explicit === 'openai') return explicit;
  // Auto: prefer Gemini (cheaper, native multimodal), fall back to OpenAI.
  if (resolveSecret('gemini_api_key')) return 'gemini';
  if (resolveSecret('openai_api_key')) return 'openai';
  throw new GenImageError(
    'No API key configured. Add one in Settings → Image generation API keys.',
    'router',
  );
}

export async function generateImage(req: GenImageRequest): Promise<GenImageResult> {
  if (!req.prompt || typeof req.prompt !== 'string') {
    throw new GenImageError('prompt is required', 'router');
  }
  if (!req.outputPath || typeof req.outputPath !== 'string') {
    throw new GenImageError('outputPath is required', 'router');
  }
  if (!path.isAbsolute(req.outputPath)) {
    throw new GenImageError('outputPath must be absolute', 'router');
  }

  const provider = pickProvider(req.provider);
  const model = req.model ?? DEFAULT_MODEL[provider];

  let result: { bytes: Uint8Array; text?: string };
  if (provider === 'gemini') {
    const key = resolveSecret('gemini_api_key');
    if (!key) {
      throw new GenImageError(
        'Gemini API key not set (Settings → Image generation API keys, or GEMINI_API_KEY env var).',
        'gemini',
      );
    }
    result = await callGemini(req, key, model);
  } else {
    const key = resolveSecret('openai_api_key');
    if (!key) {
      throw new GenImageError(
        'OpenAI API key not set (Settings → Image generation API keys, or OPENAI_API_KEY env var).',
        'openai',
      );
    }
    result = await callOpenAI(req, key, model);
  }

  const sizeBytes = writePng(req.outputPath, result.bytes);
  return {
    path: req.outputPath,
    provider,
    sizeBytes,
    model,
    text: result.text,
  };
}
