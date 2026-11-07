// The AI SDKs (SPEC 14), loaded on first use from jsDelivr at pinned versions, so the page works
// without them and without keys. Each user brings their own keys, so the Anthropic client runs in
// the browser with dangerouslyAllowBrowser.
const kAnthropicUrl = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const kGenAiUrl = 'https://cdn.jsdelivr.net/npm/@google/genai@2.31.0/+esm';
export const kPictureModel = 'gemini-nano-banana-2.1';

let anthropic_module = null;
let genai_module = null;

// { client, is_api_error } for the user's Claude key.
export async function claude_client(api_key) {
    anthropic_module ??= await import(kAnthropicUrl);
    const Anthropic = anthropic_module.default;
    return {
        client: new Anthropic({ apiKey: api_key, dangerouslyAllowBrowser: true }),
        is_api_error: err => err instanceof Anthropic.APIError,
        // Plain words for the errors a user can act on.
        explain(err) {
            if (err instanceof Anthropic.AuthenticationError) return 'The Claude key was not accepted. Check it in the assistant settings.';
            if (err instanceof Anthropic.PermissionDeniedError) return 'The Claude key cannot use this model. Pick another in the assistant settings.';
            if (err instanceof Anthropic.RateLimitError) return 'Claude is busy or the key has hit its rate limit. Wait a minute and try again.';
            if (err instanceof Anthropic.APIConnectionError) return 'Could not reach Claude. Check the internet connection.';
            if (err instanceof Anthropic.APIError) return `Claude returned an error (${err.status}): ${err.message}`;
            return err?.message ?? String(err);
        },
    };
}

// A picture from a description, as { data (base64), mime_type }, with the user's Gemini key.
export async function make_picture(api_key, description, aspect = '1:1') {
    genai_module ??= await import(kGenAiUrl);
    const ai = new genai_module.GoogleGenAI({ apiKey: api_key });
    const interaction = await ai.interactions.create({
        model: kPictureModel,
        input: description,
        response_format: { type: 'image', aspect_ratio: aspect },
    });
    // The image comes back as output_image, or as an image block in the model's output steps.
    const direct = interaction.output_image;
    if (direct?.data) return { data: direct.data, mime_type: direct.mime_type ?? 'image/png' };
    for (const step of interaction.steps ?? []) {
        for (const block of step.content ?? []) if (block.type === 'image' && block.data) return { data: block.data, mime_type: block.mime_type ?? 'image/png' };
    }
    throw new Error('the image model returned no picture');
}
