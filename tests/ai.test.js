// The assistant (SPEC M4.5): validated edits, the generated prompt and tools, and the tool loop
// driven by a stand-in client. No real API calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply_ops, clean_motif, design_summary } from '../src/ai/ops.js';
import { system_prompt, tools, invalid_input } from '../src/ai/prompt.js';
import { Assistant, kMaxRounds } from '../src/ai/agent.js';
import { GeminiAssistant, to_parts, is_gemini_model, gemini_error_words, no_free_quota } from '../src/ai/gemini_agent.js';
import { preset_by_id } from '../src/core/presets.js';
import { build_design } from '../src/pipeline/compose.js';
import { SCHEMA, kMotifTypes } from '../src/core/schema.js';

test('edits: valid operations apply in order, values clamp to the registry, bad ones are reported', () => {
    const d = preset_by_id('orb');
    const r = apply_ops(d, [
        { op: 'set', id: 'layer_count', value: 10 },
        { op: 'set', id: 'symmetry.n', value: 999 },
        { op: 'set', id: 'finish.colour', layer: 2, value: '#AA3300' },
        { op: 'set', id: 'no.such', value: 1 },
        { op: 'set', id: 'symmetry.kind', value: 'spiral' },
        { op: 'add_motif', layer: 3, motif: { type: 'lotus', r_mm: 80, width_mm: 9999 } },
        { op: 'add_motif', layer: 99, motif: { type: 'lotus' } },
        { op: 'rename', name: 'Test piece' },
    ]);
    assert.equal(r.design.layers.length, 10);
    const n_entry = SCHEMA.find(e => e.id === 'symmetry.n');
    assert.equal(r.design.piece.symmetry.n, n_entry.max, 'clamped to the maximum');
    assert.match(r.done.join(' '), /clamped/);
    assert.equal(r.design.layers[1].finish.colour, '#aa3300');
    const lotus = r.design.layers[2].source.motifs.at(-1);
    assert.equal(lotus.type, 'lotus');
    assert.equal(lotus.r_mm, 80);
    assert.ok(lotus.length_mm > 0, 'missing fields take defaults');
    assert.equal(r.errors.length, 3, r.errors.join(' | '));
    assert.match(r.errors.join(' '), /no control/);
    assert.match(r.errors.join(' '), /must be one of/);
    assert.match(r.errors.join(' '), /layer 99 does not exist/);
    assert.equal(r.design.name, 'Test piece');
    assert.notEqual(d.layers.length, 10, 'the input design is untouched');
});

test('edits: update, remove, set_motifs and generate; the result always builds', () => {
    const d = preset_by_id('orb');
    const r = apply_ops(d, [
        { op: 'set_motifs', layer: 1, motifs: [{ type: 'disc', d_mm: 60 }, { type: 'ogee', r_mm: 90 }, { type: 'window' }] },
        { op: 'update_motif', layer: 1, index: 2, fields: { length_mm: 30 } },
        { op: 'remove_motif', layer: 1, index: 3 },
        { op: 'update_motif', layer: 1, index: 9, fields: {} },
    ]);
    assert.deepEqual(r.design.layers[0].source.motifs.map(m => m.type), ['disc', 'ogee']);
    assert.equal(r.design.layers[0].source.motifs[1].length_mm, 30);
    assert.equal(r.errors.length, 1);
    const g = apply_ops(r.design, [{ op: 'generate', style: 'mandala', seed: 7 }]);
    assert.deepEqual(g.errors, []);
    assert.equal(g.design.generator.style, 'mandala');
    assert.ok(build_design(g.design).layers.every(l => l.area_mm2 > 0));
    assert.match(apply_ops(d, [{ op: 'generate', style: 'cubist' }]).errors[0], /style must be one of/);
});

test('motifs: every type cleans from its type alone; shapes need real nodes', () => {
    const d = preset_by_id('orb');
    // Artwork paths come only from draw_artwork, never from an edit.
    assert.match(clean_motif({ type: 'art' }, d, d.layers[0]).error, /comes from draw_artwork/);
    for (const type of Object.keys(kMotifTypes).filter(t => t !== 'art')) {
        const r = clean_motif({ type }, d, d.layers[0]);
        assert.ok(r.motif, `${type}: ${r.error}`);
        assert.equal(r.motif.type, type);
    }
    assert.match(clean_motif({ type: 'shape', nodes: [{ x: 1 }] }, d, d.layers[0]).error, /three nodes/);
    assert.match(clean_motif({ type: 'grid' }, d, d.layers[0]).error, /unknown motif type/);
    assert.match(clean_motif({ type: 'window', sides: 'six' }, d, d.layers[0]).error, /needs a number/);
});

test('the summary carries what the model can change, and nothing bulky', () => {
    const s = design_summary(preset_by_id('lattice'));
    assert.equal(s.layers.length, 12);
    assert.equal(s.layers[0].layer, 1);
    const lattice = s.layers.flatMap(l => l.motifs ?? []).find(m => m.type === 'lattice');
    assert.equal(typeof lattice.painted_cells, 'number');
    assert.ok(JSON.stringify(s).length < 20000, `${JSON.stringify(s).length} characters`);
});

test('the system prompt is generated from the registry and the same every time', () => {
    const a = system_prompt();
    assert.equal(a, system_prompt(), 'deterministic, so it caches');
    for (const e of SCHEMA) assert.ok(a.includes(e.id), `mentions ${e.id}`);
    for (const type of Object.keys(kMotifTypes)) assert.ok(a.includes(`- ${type} (`), `describes ${type}`);
    assert.ok(!/—/.test(a), 'no em dashes');
});

test('tools: pictures only with a picture key; inputs are checked against their schemas', () => {
    assert.ok(!tools().some(t => t.name === 'make_picture'));
    assert.ok(tools({ pictures: true }).some(t => t.name === 'make_picture'));
    assert.deepEqual(JSON.stringify(tools()), JSON.stringify(tools()), 'deterministic order');
    const look = tools().find(t => t.name === 'look');
    assert.equal(invalid_input(look, { view: 'front' }), null);
    assert.match(invalid_input(look, {}), /missing view/);
    assert.match(invalid_input(look, { view: 'side' }), /one of/);
    assert.match(invalid_input(look, { view: 'layer', layer: 1.5 }), /whole number/);
    assert.match(invalid_input(look, 'front'), /object/);
});

// A stand-in client: each call to stream() plays the next scripted message.
function stand_in(script) {
    const calls = [];
    return {
        calls,
        beta: {
            messages: {
                stream(params) {
                    calls.push(structuredClone(params));
                    const next = script.shift();
                    const handlers = {};
                    return {
                        on(event, fn) {
                            handlers[event] = fn;
                            return this;
                        },
                        async finalMessage() {
                            if (next instanceof Error) throw next;
                            for (const b of next.content) if (b.type === 'text') handlers.text?.(b.text);
                            return next;
                        },
                    };
                },
            },
        },
    };
}

const tool_use = (id, name, input) => ({ type: 'tool_use', id, name, input });

test('the loop runs tools, returns all results in one message, and ends at end_turn', async () => {
    const client = stand_in([
        { stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: 'Building the base stack.' }, tool_use('a', 'check_design', {}), tool_use('b', 'look', { view: 'front' })], usage: { input_tokens: 10, output_tokens: 5 } },
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done: a lotus mandala.' }] },
    ]);
    const events = [];
    const ran = [];
    const a = new Assistant({
        client,
        model: 'claude-opus-5-5',
        effort: 'high',
        system: system_prompt(),
        tools: tools(),
        run_tool: async (name, input) => {
            ran.push([name, input]);
            return { content: name === 'look' ? [{ type: 'text', text: 'a picture' }] : 'no problems' };
        },
        on_event: e => events.push(e),
    });
    const r = await a.send('a lotus mandala');
    assert.equal(r.reason, 'done');
    assert.deepEqual(ran.map(x => x[0]), ['check_design', 'look']);
    const results = a.messages[2];
    assert.equal(results.role, 'user');
    assert.deepEqual(results.content.map(c => c.tool_use_id), ['a', 'b'], 'both results in one message');
    assert.ok(events.some(e => e.type === 'status' && e.text === 'Building the base stack.'));
    assert.ok(events.some(e => e.type === 'text' && /lotus/.test(e.text)));
    // The request: fallbacks, adaptive thinking with progress notes, a cached system prompt.
    const p = client.calls[0];
    assert.equal(p.fallbacks, 'default');
    assert.ok(p.betas.includes('server-side-fallback-2026-07-01'));
    assert.deepEqual(p.thinking, { type: 'adaptive', display: 'updates' });
    assert.equal(p.system[0].cache_control.type, 'ephemeral');
    assert.equal(client.calls[1].messages.length, 3, 'append-only history');
});

test('the loop refuses bad inputs, stops on a refusal, and caps the rounds', async () => {
    // A bad input gets an error result and is not run.
    const c1 = stand_in([
        { stop_reason: 'tool_use', content: [tool_use('x', 'look', { view: 'sideways' })] },
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
    ]);
    let ran = 0;
    const a1 = new Assistant({ client: c1, model: 'm', effort: 'high', system: 's', tools: tools(), run_tool: async () => ((ran += 1), { content: '' }) });
    await a1.send('go');
    assert.equal(ran, 0);
    assert.equal(a1.messages[2].content[0].is_error, true);

    // A refusal discards the partial reply.
    const c2 = stand_in([{ stop_reason: 'refusal', stop_details: { explanation: 'declined' }, content: [{ type: 'text', text: 'part' }] }]);
    const a2 = new Assistant({ client: c2, model: 'm', effort: 'high', system: 's', tools: tools(), run_tool: async () => ({ content: '' }) });
    const r2 = await a2.send('go');
    assert.deepEqual(r2, { reason: 'refused', detail: 'declined' });
    assert.equal(a2.messages.length, 1, 'only the user message stays');

    // Input cut off at max_tokens is never run.
    const c3 = stand_in([
        { stop_reason: 'max_tokens', content: [tool_use('t', 'draw_artwork', { layer: 1, svg: '<svg', as: 'openings' })] },
        { stop_reason: 'end_turn', content: [] },
    ]);
    let ran3 = 0;
    const a3 = new Assistant({ client: c3, model: 'm', effort: 'high', system: 's', tools: tools(), run_tool: async () => ((ran3 += 1), { content: '' }) });
    await a3.send('go');
    assert.equal(ran3, 0);
    assert.match(a3.messages[2].content[0].content, /cut off/);

    // A model that never stops calling tools ends at the round cap.
    const endless = Array.from({ length: kMaxRounds + 2 }, (_, i) => ({ stop_reason: 'tool_use', content: [tool_use(`r${i}`, 'check_design', {})] }));
    const a4 = new Assistant({ client: stand_in(endless), model: 'm', effort: 'high', system: 's', tools: tools(), run_tool: async () => ({ content: 'ok' }) });
    assert.equal((await a4.send('go')).reason, 'round_cap');

    // API errors are not retried.
    const api_error = Object.assign(new Error('overloaded'), { status: 529 });
    const a5 = new Assistant({ client: stand_in([api_error]), model: 'm', effort: 'high', system: 's', tools: tools(), run_tool: async () => ({ content: '' }) });
    await assert.rejects(a5.send('go'), /overloaded/);

    // Stop before a round.
    const ctl = new AbortController();
    ctl.abort();
    const a6 = new Assistant({ client: stand_in([]), model: 'm', effort: 'high', system: 's', tools: tools(), run_tool: async () => ({ content: '' }) });
    assert.equal((await a6.send('go', { signal: ctl.signal })).reason, 'stopped');
});

// A stand-in Gemini client: each call to generateContentStream() streams the next scripted
// response, one part per chunk, with the finish reason and usage on the last chunk.
function gemini_stand_in(script) {
    const calls = [];
    return {
        calls,
        models: {
            async generateContentStream(params) {
                calls.push(structuredClone({ ...params, config: { ...params.config, abortSignal: undefined } }));
                const next = script.shift();
                if (next instanceof Error) throw next;
                return (async function* () {
                    const c = next.candidates?.[0];
                    const parts = c?.content?.parts ?? [];
                    if (!parts.length) return void (yield next);
                    for (let i = 0; i < parts.length; i++) {
                        const last = i === parts.length - 1;
                        yield {
                            candidates: [{ content: { role: 'model', parts: [parts[i]] }, ...(last ? { finishReason: c.finishReason } : {}) }],
                            ...(last && next.usageMetadata ? { usageMetadata: next.usageMetadata } : {}),
                        };
                    }
                })();
            },
        },
    };
}
const reply = (parts, finishReason = 'STOP', extra = {}) => ({ candidates: [{ content: { role: 'model', parts }, finishReason }], ...extra });
const call = (id, name, args) => ({ functionCall: { id, name, args } });

test('Gemini: the loop runs tools, answers every call in one turn, and keeps the model turns as they came', async () => {
    const client = gemini_stand_in([
        reply([{ text: 'Building the base stack.', thought: true }, { ...call('a', 'check_design', {}), thoughtSignature: 'sig-1' }, call('b', 'look', { view: 'front' })], 'STOP', { usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 5, thoughtsTokenCount: 7 } }),
        reply([{ text: 'Done: a lotus mandala.' }]),
    ]);
    const events = [];
    const ran = [];
    const a = new GeminiAssistant({
        client,
        model: 'gemini-pro-latest',
        effort: 'medium',
        system: system_prompt(),
        tools: tools(),
        run_tool: async (name, input) => {
            ran.push(name);
            return { content: name === 'look' ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'a picture' }] : 'no problems' };
        },
        on_event: e => events.push(e),
    });
    const r = await a.send([{ type: 'text', text: 'a lotus mandala' }]);
    assert.equal(r.reason, 'done');
    assert.deepEqual(ran, ['check_design', 'look']);
    // The model's turn goes back verbatim, thought signature and all.
    assert.equal(a.contents[1].role, 'model');
    assert.equal(a.contents[1].parts[1].thoughtSignature, 'sig-1');
    // Both results in one user turn, matched by id; the picture rides inside its function response.
    const results = a.contents[2];
    assert.equal(results.role, 'user');
    assert.deepEqual(results.parts.map(p => p.functionResponse.id), ['a', 'b']);
    assert.deepEqual(results.parts[0].functionResponse.response, { output: 'no problems' });
    assert.deepEqual(results.parts[1].functionResponse.parts, [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }]);
    assert.ok(events.some(e => e.type === 'thinking' && e.text === 'Building the base stack.'), 'thoughts stream as progress');
    assert.ok(events.some(e => e.type === 'text' && /lotus/.test(e.text)));
    assert.deepEqual(events.find(e => e.type === 'usage').usage, { input_tokens: 60, cache_read_input_tokens: 40, output_tokens: 12 });
    // The request: the same system prompt and tools, as JSON Schema declarations.
    const p = client.calls[0];
    assert.equal(p.model, 'gemini-pro-latest');
    assert.equal(p.config.systemInstruction, system_prompt());
    const decls = p.config.tools[0].functionDeclarations;
    assert.deepEqual(decls.map(d => d.name), tools().map(t => t.name));
    assert.ok(decls.every(d => d.parametersJsonSchema?.type === 'object' && !('eager_input_streaming' in d)));
    assert.deepEqual(p.config.thinkingConfig, { thinkingLevel: 'LOW', includeThoughts: true });
    assert.equal(client.calls[1].contents.length, 3, 'the history grows by whole turns');
    assert.ok(is_gemini_model('gemini-flash-latest') && !is_gemini_model('claude-opus-5-5'));
});

test('Gemini: bad inputs are not run, blocks end the turn, malformed calls are asked again, rounds are capped', async () => {
    const mk = (script, run_tool = async () => ({ content: 'ok' })) => new GeminiAssistant({ client: gemini_stand_in(script), model: 'gemini-flash-latest', effort: 'high', system: 's', tools: tools(), run_tool });
    // A bad input gets an error response and is not run.
    let ran = 0;
    const a1 = mk([reply([call('x', 'look', { view: 'sideways' })]), reply([{ text: 'ok' }])], async () => ((ran += 1), { content: '' }));
    await a1.send('go');
    assert.equal(ran, 0);
    assert.match(a1.contents[2].parts[0].functionResponse.response.error, /Not run: view must be one of/);

    // A safety block keeps nothing of the turn.
    const a2 = mk([{ candidates: [{ finishReason: 'SAFETY' }] }]);
    assert.equal((await a2.send('go')).reason, 'refused');
    assert.equal(a2.contents.length, 0, 'the history is as it was');
    const a2b = mk([{ promptFeedback: { blockReason: 'OTHER', blockReasonMessage: 'blocked' } }]);
    assert.deepEqual(await a2b.send('go'), { reason: 'refused', detail: 'blocked' });

    // A malformed function call is asked again, and the retry is not added to the history.
    const a3 = mk([{ candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }] }, reply([{ text: 'fine' }])]);
    assert.equal((await a3.send('go')).reason, 'done');
    assert.equal(a3.contents.length, 2);

    // Input cut off at the token limit is never run.
    let ran4 = 0;
    const a4 = mk([reply([call('t', 'draw_artwork', { layer: 1, svg: '<svg', as: 'openings' })], 'MAX_TOKENS'), reply([{ text: 'ok' }])], async () => ((ran4 += 1), { content: '' }));
    await a4.send('go');
    assert.equal(ran4, 0);
    assert.match(a4.contents[2].parts[0].functionResponse.response.error, /cut off/);

    // A model that never stops calling tools ends at the round cap; API errors are thrown.
    const endless = Array.from({ length: kMaxRounds + 2 }, (_, i) => reply([call(`r${i}`, 'check_design', {})]));
    assert.equal((await mk(endless).send('go')).reason, 'round_cap');
    await assert.rejects(mk([Object.assign(new Error('quota'), { status: 429 })]).send('go'), /quota/);
    const ctl = new AbortController();
    ctl.abort();
    assert.equal((await mk([]).send('go', { signal: ctl.signal })).reason, 'stopped');

    // The panel's message content (text and pictures) as Gemini parts.
    assert.deepEqual(to_parts([{ type: 'text', text: 'hi' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QQ' } }]), [{ text: 'hi' }, { inlineData: { mimeType: 'image/jpeg', data: 'QQ' } }]);
});

// Google's error bodies, as the SDK puts them in ApiError.message.
const quota_body = (limit, quota_id, delay) => JSON.stringify({ error: { code: 429, message: `You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: ${limit}, model: gemini-3.1-pro`, status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: quota_id }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay }] } });

test('Gemini: a failed turn leaves the history as it was, and errors read as what to do', async () => {
    // A quota error on the first message: nothing stays, so sending again starts clean.
    const zero = Object.assign(new Error(quota_body(0, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', '37s')), { status: 429 });
    const client = gemini_stand_in([zero, reply([{ text: 'ok' }])]);
    const a = new GeminiAssistant({ client, model: 'gemini-pro-latest', effort: 'high', system: 's', tools: tools(), run_tool: async () => ({ content: 'ok' }) });
    await assert.rejects(a.send('first'));
    assert.equal(a.contents.length, 0);
    assert.equal((await a.send('again')).reason, 'done');
    assert.deepEqual(client.calls[1].contents.map(c => c.role), ['user'], 'one user turn, not two');

    // After the round cap, "carry on" joins the function responses instead of starting a second user turn.
    const capped = Array.from({ length: kMaxRounds }, (_, i) => reply([call(`r${i}`, 'check_design', {})]));
    const c2 = gemini_stand_in([...capped, reply([{ text: 'finished' }])]);
    const b = new GeminiAssistant({ client: c2, model: 'gemini-flash-latest', effort: 'high', system: 's', tools: tools(), run_tool: async () => ({ content: 'ok' }) });
    assert.equal((await b.send('go')).reason, 'round_cap');
    assert.equal((await b.send('carry on')).reason, 'done');
    const sent = c2.calls.at(-1).contents;
    assert.ok(sent.every((c, i) => i === 0 || c.role !== sent[i - 1].role), 'turns alternate');
    assert.deepEqual(sent.at(-1).parts.map(p => Object.keys(p)[0]), ['functionResponse', 'text']);

    // A limit of 0 is not a wait: the model is not in the key's free tier.
    assert.ok(no_free_quota(429, zero.message));
    assert.match(gemini_error_words(429, zero.message), /free tier does not include this model.*Gemini Flash/);
    const minute = quota_body(5, 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '21s');
    assert.ok(!no_free_quota(429, minute));
    assert.match(gemini_error_words(429, minute), /per-minute limit\. Wait 21 s/);
    assert.match(gemini_error_words(429, quota_body(100, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', '0s')), /today/);
    assert.match(gemini_error_words(400, JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } })), /key was not accepted/);
    assert.match(gemini_error_words(400, JSON.stringify({ error: { code: 400, message: 'Invalid JSON payload' } })), /\(400\): Invalid JSON payload$/);
});

test('Gemini: a reply that goes quiet is dropped with a clear error, and Stop ends a streaming reply', async () => {
    // A stream that never sends anything until it is aborted.
    const hang = {
        models: {
            async generateContentStream(params) {
                const signal = params.config.abortSignal;
                return (async function* () {
                    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
                })();
            },
        },
    };
    const mk = () => new GeminiAssistant({ client: hang, model: 'gemini-flash-latest', effort: 'high', system: 's', tools: tools(), run_tool: async () => ({ content: '' }), idle_ms: 40 });
    const a = mk();
    await assert.rejects(a.send('go'), /Gemini sent nothing for 0 s/);
    assert.equal(a.contents.length, 0, 'the history is as it was');
    const b = new GeminiAssistant({ client: hang, model: 'gemini-flash-latest', effort: 'high', system: 's', tools: tools(), run_tool: async () => ({ content: '' }) });
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 20);
    assert.equal((await b.send('go', { signal: ctl.signal })).reason, 'stopped');
    assert.equal(b.contents.length, 0);
});
