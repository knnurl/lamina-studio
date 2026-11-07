// The assistant's tool loop on Gemini (SPEC M4.5), with the user's own key: streamed
// generateContent with function calling, the same tools and events as the Claude loop (agent.js).
// One request from the user may take many rounds of tool calls. A turn ends when a reply calls no
// tools, on a safety block, at the round cap, or when the user presses Stop. The model's turns go
// back into the history exactly as they came, part by part, so their thought signatures stay valid.
import { invalid_input } from './prompt.js';

// Free keys get no Pro quota (a limit of 0), so Pro needs billing on the key's project.
export const kGeminiModels = {
    'gemini-pro-latest': 'Gemini Pro (best designs, needs billing)',
    'gemini-flash-latest': 'Gemini Flash (works with a free key)',
};
export const kFreeGeminiModel = 'gemini-flash-latest';

// The SDK's ApiError message is Google's JSON error body. True when the key's tier has no quota
// at all for the model, which waiting does not fix.
export const no_free_quota = (status, raw) => status === 429 && /limit: 0\b|"quotaValue":"0"/.test(String(raw));

// Plain words for a Gemini API error a user can act on.
export function gemini_error_words(status, raw) {
    let message = String(raw);
    try {
        message = JSON.parse(raw).error?.message ?? message;
    } catch {
        // Not JSON: use it as it is.
    }
    if (status === 401 || status === 403 || (status === 400 && /api key/i.test(message))) return 'The Gemini key was not accepted. Check it in the assistant settings.';
    if (status === 404) return 'Your Gemini key cannot use this model. Pick another in the assistant settings.';
    if (no_free_quota(status, raw)) return 'Your key’s free tier does not include this model: Google gives it a limit of 0, so waiting will not help. Use Gemini Flash, which works with a free key, or turn on billing for the key’s project in AI Studio.';
    if (status === 429 && /PerDay/.test(raw)) return 'The Gemini key has used today’s free requests for this model. Try again tomorrow, pick another model, or turn on billing in AI Studio.';
    if (status === 429) {
        const wait_s = /"retryDelay":"(\d+)/.exec(raw)?.[1];
        return `The Gemini key has hit its per-minute limit. Wait ${wait_s ? `${wait_s} s` : 'a minute'} and send again.`;
    }
    if (status >= 500) return 'Gemini is busy. Wait a minute and try again.';
    return `Gemini returned an error (${status}): ${message}`;
}
// Effort maps onto the thinking levels every Gemini 3 model accepts (the SDK's ThinkingLevel values).
const kThinking = { medium: 'LOW', high: 'HIGH', xhigh: 'HIGH' };
const kBlocked = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY'];
export const kMaxRounds = 30;
// A reply that sends nothing for this long is dropped (thinking at high effort can be quiet for a
// minute or more before the first summary).
export const kIdleMs = 180000;

export const is_gemini_model = model => String(model).startsWith('gemini-');

// Anthropic-shaped content (a string, or text and base64 image blocks) as Gemini parts.
export function to_parts(content) {
    if (typeof content === 'string') return [{ text: content }];
    return content.map(b => (b.type === 'image' ? { inlineData: { mimeType: b.source.media_type, data: b.source.data } } : { text: b.text }));
}

// A tool's result as a function response: its text as output (or error), its pictures as parts.
export function function_response(call, r) {
    const blocks = typeof r.content === 'string' ? [{ type: 'text', text: r.content }] : r.content;
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const images = blocks.filter(b => b.type === 'image').map(b => ({ inlineData: { mimeType: b.source.media_type, data: b.source.data } }));
    return {
        functionResponse: {
            ...(call.id ? { id: call.id } : {}),
            name: call.name,
            response: r.is_error ? { error: text } : { output: text },
            ...(images.length ? { parts: images } : {}),
        },
    };
}

export class GeminiAssistant {
    // client: a GoogleGenAI instance, or anything with models.generateContent(params) (tests pass a
    //   stand-in). The rest is as for Assistant in agent.js.
    constructor({ client, is_api_error, model, effort, system, tools, run_tool, on_event, idle_ms = kIdleMs }) {
        this.client_ = client;
        this.idle_ms_ = idle_ms;
        this.is_api_error_ = is_api_error ?? (err => typeof err?.status === 'number');
        this.model = model;
        this.effort = effort;
        this.system_ = system;
        this.tools_ = tools;
        this.declarations_ = tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema }));
        this.run_tool_ = run_tool;
        this.on_event_ = on_event ?? (() => {});
        this.contents = [];
    }

    params_(signal) {
        return {
            model: this.model,
            contents: this.contents,
            config: {
                systemInstruction: this.system_,
                tools: [{ functionDeclarations: this.declarations_ }],
                thinkingConfig: { thinkingLevel: kThinking[this.effort] ?? 'HIGH', includeThoughts: true },
                maxOutputTokens: 65536,
                ...(signal ? { abortSignal: signal } : {}),
            },
        };
    }

    // One streamed reply, gathered into the shape of a whole one. Thoughts and text are passed on
    // as they arrive; every part is kept as it came, including empty ones carrying a signature.
    async request_(signal) {
        const ctl = new AbortController();
        const forward = () => ctl.abort();
        signal?.addEventListener('abort', forward, { once: true });
        let timer = 0;
        let idle = false;
        const poke = () => {
            clearTimeout(timer);
            timer = setTimeout(() => ((idle = true), ctl.abort()), this.idle_ms_);
        };
        const parts = [];
        let finishReason = '';
        let usageMetadata = null;
        let promptFeedback = null;
        poke();
        try {
            const stream = await this.client_.models.generateContentStream(this.params_(ctl.signal));
            for await (const chunk of stream) {
                poke();
                usageMetadata = chunk.usageMetadata ?? usageMetadata;
                promptFeedback = chunk.promptFeedback ?? promptFeedback;
                const c = chunk.candidates?.[0];
                finishReason = c?.finishReason ?? finishReason;
                for (const p of c?.content?.parts ?? []) {
                    parts.push(p);
                    if (p.text) this.on_event_(p.thought ? { type: 'thinking', text: p.text } : { type: 'text', text: p.text });
                }
            }
        } catch (err) {
            if (idle) throw new Error(`Gemini sent nothing for ${Math.round(this.idle_ms_ / 1000)} s, so the request was dropped. Send again.`);
            throw err;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', forward);
        }
        return { candidates: [{ content: parts.length ? { role: 'model', parts } : undefined, finishReason }], usageMetadata, promptFeedback };
    }

    async send(content, { signal } = {}) {
        // A turn that fails, is blocked or is stopped leaves the history as it was, so the user can
        // send again (the design keeps any changes, and travels with the next message).
        const start = this.contents.length;
        // After the round cap the history ends with function responses: the new words join them.
        const last = this.contents.at(-1);
        const merged_from = last?.role === 'user' ? last.parts.length : null;
        if (merged_from !== null) last.parts.push(...to_parts(content));
        else this.contents.push({ role: 'user', parts: to_parts(content) });
        const rollback = result => {
            this.contents.length = start;
            if (merged_from !== null) last.parts.length = merged_from;
            return result;
        };
        let retries = 0;
        for (let round = 0; round < kMaxRounds; round++) {
            if (signal?.aborted) return rollback({ reason: 'stopped' });
            let response;
            try {
                response = await this.request_(signal);
            } catch (err) {
                if (signal?.aborted) return rollback({ reason: 'stopped' });
                rollback();
                throw err;
            }
            const u = response.usageMetadata;
            if (u) {
                const cached = u.cachedContentTokenCount ?? 0;
                this.on_event_({ type: 'usage', usage: { input_tokens: (u.promptTokenCount ?? 0) - cached, cache_read_input_tokens: cached, output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } });
            }
            const candidate = response.candidates?.[0];
            const reason = candidate?.finishReason ?? '';
            const blocked = response.promptFeedback?.blockReason;
            if (blocked || kBlocked.includes(reason)) {
                return rollback({ reason: 'refused', detail: response.promptFeedback?.blockReasonMessage ?? null });
            }
            // A function call the model could not form: ask again, a few times.
            if (reason === 'MALFORMED_FUNCTION_CALL' || reason === 'UNEXPECTED_TOOL_CALL' || !candidate?.content?.parts) {
                if (retries++ >= 2) return rollback({ reason: reason || 'empty' });
                continue;
            }
            retries = 0;
            const parts = candidate.content.parts;
            this.contents.push({ role: 'model', parts });
            const calls = parts.filter(p => p.functionCall).map(p => p.functionCall);
            if (!calls.length) return { reason: reason === 'STOP' || !reason ? 'done' : reason.toLowerCase() };

            const results = [];
            for (const call of calls) {
                const tool = this.tools_.find(t => t.name === call.name);
                const input = call.args ?? {};
                const bad = !tool ? `there is no tool ${call.name}` : reason === 'MAX_TOKENS' ? 'the reply was cut off before this input was complete; send a shorter one' : invalid_input(tool, input);
                if (bad) {
                    results.push(function_response(call, { is_error: true, content: `Not run: ${bad}.` }));
                    continue;
                }
                this.on_event_({ type: 'tool', name: call.name, input });
                try {
                    const r = await this.run_tool_(call.name, input);
                    results.push(function_response(call, r));
                    this.on_event_({ type: 'tool_done', name: call.name, is_error: !!r.is_error });
                } catch (err) {
                    results.push(function_response(call, { is_error: true, content: `Failed: ${err.message}` }));
                    this.on_event_({ type: 'tool_done', name: call.name, is_error: true });
                }
            }
            // Every result of the round in one turn, in the order of the calls.
            this.contents.push({ role: 'user', parts: results });
            if (signal?.aborted) return rollback({ reason: 'stopped' });
        }
        return { reason: 'round_cap' };
    }
}
