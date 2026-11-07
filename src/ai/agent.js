// The assistant's tool loop (SPEC M4.5): Claude through the Anthropic SDK's streaming manual loop,
// run in the page with the user's own key. One request from the user may take many rounds of tool
// calls. A turn ends at end_turn, on a refusal, at the round cap, or when the user presses Stop.
// The conversation is append-only: earlier messages are never edited, so cached prefixes and
// thinking blocks stay valid.
import { invalid_input } from './prompt.js';

export const kModels = {
    'claude-opus-5-5': 'Claude Opus 5.5 (best designs)',
    'claude-sonnet-5-5': 'Claude Sonnet 5.5 (faster, cheaper)',
};
export const kEfforts = ['medium', 'high', 'xhigh'];
// Refusal fallbacks (the "default" form) and progress notes between tool calls.
const kBetas = ['server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18'];
export const kMaxRounds = 30;

export class Assistant {
    // client: an Anthropic client, or anything with beta.messages.stream(params, options) that
    //   returns { on(event, fn), finalMessage() } (tests pass a stand-in).
    // is_api_error(err): true for the SDK's API errors, which are never retried here.
    // run_tool(name, input): Promise<{ content: string | blocks, is_error?: boolean }>.
    // on_event(e): { type: 'text', text } | { type: 'status', text } | { type: 'tool', name, input }
    //   | { type: 'tool_done', name, is_error } | { type: 'usage', usage }.
    constructor({ client, is_api_error, model, effort, system, tools, run_tool, on_event }) {
        this.client_ = client;
        this.is_api_error_ = is_api_error ?? (err => typeof err?.status === 'number');
        this.model = model;
        this.effort = effort;
        this.system_ = system;
        this.tools_ = tools;
        this.run_tool_ = run_tool;
        this.on_event_ = on_event ?? (() => {});
        this.messages = [];
    }

    params_() {
        return {
            model: this.model,
            max_tokens: 64000,
            betas: kBetas,
            fallbacks: 'default',
            thinking: { type: 'adaptive', display: 'updates' },
            output_config: { effort: this.effort },
            // The system prompt is fixed, so it caches; the top-level breakpoint moves along the
            // conversation, so each round re-reads the previous one from the cache.
            system: [{ type: 'text', text: this.system_, cache_control: { type: 'ephemeral' } }],
            cache_control: { type: 'ephemeral' },
            tools: this.tools_,
            messages: this.messages,
        };
    }

    // Runs one user turn. content is the user message's content. Resolves with
    // { reason: 'done' | 'refused' | 'stopped' | 'round_cap' | other stop reason, detail? }.
    async send(content, { signal } = {}) {
        this.messages.push({ role: 'user', content });
        let json_retries = 0;
        for (let round = 0; round < kMaxRounds; round++) {
            if (signal?.aborted) return { reason: 'stopped' };
            const stream = this.client_.beta.messages.stream(this.params_(), { signal });
            stream.on('text', text => this.on_event_({ type: 'text', text }));
            let message;
            try {
                message = await stream.finalMessage();
                json_retries = 0;
            } catch (err) {
                if (signal?.aborted) return { reason: 'stopped' };
                // A tool input that could not be parsed at all: re-issue the round, a few times.
                if (this.is_api_error_(err) || json_retries++ >= 2) throw err;
                continue;
            }
            if (message.usage) this.on_event_({ type: 'usage', usage: message.usage });
            // Progress notes come back as thinking blocks with text (display "updates").
            for (const b of message.content) if (b.type === 'thinking' && b.thinking) this.on_event_({ type: 'status', text: b.thinking });

            if (message.stop_reason === 'refusal') {
                // Discard the partial reply; the conversation stays as it was before this round.
                return { reason: 'refused', detail: message.stop_details?.explanation ?? null };
            }
            this.messages.push({ role: 'assistant', content: message.content });
            if (message.stop_reason === 'pause_turn') continue;
            const uses = message.content.filter(b => b.type === 'tool_use');
            if (!uses.length) return { reason: message.stop_reason === 'end_turn' ? 'done' : message.stop_reason };

            const results = [];
            for (const use of uses) {
                const tool = this.tools_.find(t => t.name === use.name);
                // A reply cut off at max_tokens can hold a silently truncated tool input.
                const bad = !tool ? `there is no tool ${use.name}` : message.stop_reason === 'max_tokens' ? 'the reply was cut off before this input was complete; send a shorter one' : invalid_input(tool, use.input);
                if (bad) {
                    results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Not run: ${bad}.` });
                    continue;
                }
                this.on_event_({ type: 'tool', name: use.name, input: use.input });
                try {
                    const r = await this.run_tool_(use.name, use.input);
                    results.push({ type: 'tool_result', tool_use_id: use.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
                    this.on_event_({ type: 'tool_done', name: use.name, is_error: !!r.is_error });
                } catch (err) {
                    results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Failed: ${err.message}` });
                    this.on_event_({ type: 'tool_done', name: use.name, is_error: true });
                }
            }
            // Every result of the round in one message, so parallel calls stay parallel.
            this.messages.push({ role: 'user', content: results });
            if (signal?.aborted) return { reason: 'stopped' };
        }
        return { reason: 'round_cap' };
    }
}
