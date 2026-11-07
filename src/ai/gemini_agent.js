// The assistant's tool loop on Gemini (SPEC M4.5), with the user's own key: generateContent with
// function calling, the same tools and events as the Claude loop (agent.js). One request from the
// user may take many rounds of tool calls. A turn ends when a reply calls no tools, on a safety
// block, at the round cap, or when the user presses Stop. The model's turns go back into the
// history exactly as they came, so their thought signatures stay valid.
import { invalid_input } from './prompt.js';

export const kGeminiModels = {
    'gemini-pro-latest': 'Gemini Pro (best designs)',
    'gemini-flash-latest': 'Gemini Flash (faster, cheaper)',
};
// Effort maps onto the thinking levels every Gemini 3 model accepts (the SDK's ThinkingLevel values).
const kThinking = { medium: 'LOW', high: 'HIGH', xhigh: 'HIGH' };
const kBlocked = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY'];
export const kMaxRounds = 30;

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
    constructor({ client, is_api_error, model, effort, system, tools, run_tool, on_event }) {
        this.client_ = client;
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

    async send(content, { signal } = {}) {
        this.contents.push({ role: 'user', parts: to_parts(content) });
        let retries = 0;
        for (let round = 0; round < kMaxRounds; round++) {
            if (signal?.aborted) return { reason: 'stopped' };
            let response;
            try {
                response = await this.client_.models.generateContent(this.params_(signal));
            } catch (err) {
                if (signal?.aborted) return { reason: 'stopped' };
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
                // Nothing of a blocked reply joins the conversation.
                return { reason: 'refused', detail: response.promptFeedback?.blockReasonMessage ?? null };
            }
            // A function call the model could not form: ask again, a few times.
            if (reason === 'MALFORMED_FUNCTION_CALL' || reason === 'UNEXPECTED_TOOL_CALL' || !candidate?.content?.parts) {
                if (retries++ >= 2) return { reason: reason || 'empty' };
                continue;
            }
            retries = 0;
            const parts = candidate.content.parts;
            this.contents.push({ role: 'model', parts });
            for (const p of parts) {
                if (!p.text) continue;
                this.on_event_(p.thought ? { type: 'status', text: p.text } : { type: 'text', text: p.text });
            }
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
            if (signal?.aborted) return { reason: 'stopped' };
        }
        return { reason: 'round_cap' };
    }
}
