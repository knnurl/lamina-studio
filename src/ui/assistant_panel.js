// Assistant panel (SPEC M4.5): a drawer beside the preview with the conversation, a message box,
// Stop, and settings for the user's own keys, model and effort. Every change the assistant makes
// is an undo step in the studio.
// Testing seam: when globalThis.__lamina_ai_stand_in is set (only by test scripts) it is used in
// place of the SDK client: { client, is_api_error, explain }.
import { el } from './dom.js';
import { Assistant, kModels, kEfforts } from '../ai/agent.js';
import { claude_client } from '../ai/sdk.js';
import { system_prompt, tools } from '../ai/prompt.js';
import { design_summary } from '../ai/ops.js';
import { make_tool_runner } from '../ai/run_tools.js';
import { load_settings, save_settings, forget_keys } from '../ai/settings.js';

const kToolWords = {
    edit_design: 'Changing the design',
    check_design: 'Checking',
    look: 'Looking',
    draw_artwork: 'Drawing artwork',
    make_picture: 'Asking Gemini for a picture',
    trace_picture: 'Tracing the picture into layers',
};

export class AssistantPanel {
    // ctx: the tool context (see ai/run_tools.js) minus pictures, add_picture and gemini_key,
    // which the panel owns. on_open(open) tells the app the drawer opened or closed.
    constructor(container, ctx, { on_open } = {}) {
        this.ctx_ = ctx;
        this.on_open_ = on_open ?? (() => {});
        this.settings_ = load_settings();
        this.pictures_ = new Map();
        this.assistant_ = null;
        this.running_ = null; // AbortController while a turn runs
        this.usage_ = { input: 0, output: 0, cache_read: 0 };

        this.root_ = el('aside', { class: 'assistant-drawer', hidden: '', 'aria-label': 'Assistant' });
        const title = el('div', { class: 'assistant-head' }, [el('strong', { text: 'Assistant' })]);
        this.model_chip_ = el('span', { class: 'chip' });
        const gear = el('button', { type: 'button', class: 'tool small', text: 'Settings', title: 'Keys, model and effort' });
        gear.addEventListener('click', () => this.show_settings_(!this.settings_open_));
        const fresh = el('button', { type: 'button', class: 'tool small', text: 'New chat', title: 'Start a new conversation (the design stays)' });
        fresh.addEventListener('click', () => this.new_chat_());
        const close = el('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Close the assistant', text: '×' });
        close.addEventListener('click', () => this.set_open(false));
        title.append(this.model_chip_, el('span', { class: 'spacer' }), fresh, gear, close);

        this.settings_box_ = el('div', { class: 'assistant-settings', hidden: '' });
        this.log_ = el('div', { class: 'assistant-log', role: 'log', 'aria-live': 'polite' });
        this.input_ = el('textarea', { class: 'assistant-input', rows: 3, placeholder: 'Describe a piece, or what to change. For example: a 10-layer lotus mandala with a key-fret border, deep blue to gold.', 'aria-label': 'Message to the assistant' });
        this.input_.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.send(this.input_.value);
            }
        });
        this.send_btn_ = el('button', { type: 'button', class: 'btn', text: 'Send' });
        this.send_btn_.addEventListener('click', () => this.send(this.input_.value));
        this.stop_btn_ = el('button', { type: 'button', class: 'btn ghost', text: 'Stop', hidden: '' });
        this.stop_btn_.addEventListener('click', () => this.running_?.abort());
        this.usage_line_ = el('span', { class: 'assistant-usage' });
        // Your own picture: shown here, sent with the next message, and traceable like any other.
        this.pending_ = [];
        const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: '', 'aria-label': 'Add a picture' });
        file.addEventListener('change', async () => {
            for (const f of file.files) await this.add_user_picture_(f);
            file.value = '';
        });
        const add_picture = el('button', { type: 'button', class: 'tool small', text: 'Add a picture', title: 'A photo or drawing for the assistant to trace or work from' });
        add_picture.addEventListener('click', () => file.click());
        this.file_ = file;
        const foot = el('div', { class: 'assistant-foot' }, [this.input_, el('div', { class: 'assistant-actions' }, [add_picture, file, this.usage_line_, el('span', { class: 'spacer' }), this.stop_btn_, this.send_btn_])]);
        this.root_.append(title, this.settings_box_, this.log_, foot);
        container.append(this.root_);
        this.refresh_chip_();
        if (!this.settings_.claude_key) this.note_setup_();
    }

    get open() {
        return !this.root_.hidden;
    }

    set_open(open) {
        this.root_.hidden = !open;
        this.on_open_(open);
        if (open) this.input_.focus();
    }

    refresh_chip_() {
        this.model_chip_.textContent = (kModels[this.settings_.model] ?? this.settings_.model).replace(/ \(.*\)$/, '');
    }

    add_(cls, text) {
        const line = el('div', { class: `msg ${cls}`, text });
        this.log_.append(line);
        this.log_.scrollTop = this.log_.scrollHeight;
        return line;
    }

    note_setup_() {
        const card = el('div', { class: 'msg setup' }, [
            el('p', { text: 'The assistant designs and edits pieces for you, draws artwork, and traces pictures into layers. It needs your own Claude API key; a Gemini key adds pictures from a description. Keys stay in this browser.' }),
        ]);
        const go = el('button', { type: 'button', class: 'btn', text: 'Add keys' });
        go.addEventListener('click', () => this.show_settings_(true));
        card.append(go);
        this.log_.append(card);
    }

    show_settings_(open) {
        this.settings_open_ = open;
        this.settings_box_.hidden = !open;
        if (!open) return;
        const s = this.settings_;
        const box = this.settings_box_;
        box.textContent = '';
        const field = (label, input, note) => el('label', { class: 'cal-field' }, [el('span', { text: label }), input, ...(note ? [el('small', { text: note })] : [])]);
        const claude = el('input', { type: 'password', value: s.claude_key, autocomplete: 'off', placeholder: 'sk-ant-...' });
        const gemini = el('input', { type: 'password', value: s.gemini_key, autocomplete: 'off', placeholder: 'optional' });
        const model = el('select');
        for (const [id, label] of Object.entries(kModels)) model.append(el('option', { value: id, text: label }));
        model.value = s.model;
        const effort = el('select');
        for (const e of kEfforts) effort.append(el('option', { value: e, text: { medium: 'Medium: quicker', high: 'High: careful', xhigh: 'Extra high: most careful, slowest' }[e] }));
        effort.value = s.effort;
        const remember = el('input', { type: 'checkbox' });
        remember.checked = s.remember;
        const save = el('button', { type: 'button', class: 'btn', text: 'Save' });
        save.addEventListener('click', () => {
            this.settings_ = { claude_key: claude.value.trim(), gemini_key: gemini.value.trim(), model: model.value, effort: effort.value, remember: remember.checked };
            save_settings(this.settings_);
            this.assistant_ = null; // rebuilt with the new settings on the next message
            this.refresh_chip_();
            this.show_settings_(false);
            this.add_('note', `Saved. ${this.settings_.claude_key ? 'Ready.' : 'Add a Claude key to start.'}${this.settings_.gemini_key ? ' Pictures from a description are on.' : ''}`);
        });
        const forget = el('button', { type: 'button', class: 'btn ghost', text: 'Forget keys' });
        forget.addEventListener('click', () => {
            this.settings_ = forget_keys(this.settings_);
            this.assistant_ = null;
            this.show_settings_(false);
            this.add_('note', 'Keys forgotten in this browser.');
        });
        box.append(
            field('Claude API key', claude, 'From console.anthropic.com. Calls go from this page straight to Anthropic, billed to your key.'),
            field('Gemini API key', gemini, 'Optional, from aistudio.google.com: pictures from a description.'),
            field('Model', model),
            field('Effort', effort),
            el('label', { class: 'ctl-toggle' }, [remember, el('span', { text: ' Remember keys on this device (otherwise only until the tab closes)' })]),
            el('div', { class: 'assistant-actions' }, [forget, el('span', { class: 'spacer' }), save]),
        );
    }

    new_chat_() {
        this.running_?.abort();
        this.assistant_ = null;
        this.pictures_.clear();
        this.pending_ = [];
        this.usage_ = { input: 0, output: 0, cache_read: 0 };
        this.usage_line_.textContent = '';
        this.log_.textContent = '';
        this.add_('note', 'New conversation. The design is unchanged.');
    }

    async assistant_for_() {
        if (this.assistant_) return this.assistant_;
        const sdk = globalThis.__lamina_ai_stand_in ?? (await claude_client(this.settings_.claude_key));
        this.explain_ = sdk.explain ?? (err => err?.message ?? String(err));
        const ctx = {
            ...this.ctx_,
            pictures: this.pictures_,
            gemini_key: this.settings_.gemini_key,
            add_picture: picture => {
                const id = `p${this.pictures_.size + 1}`;
                this.pictures_.set(id, picture);
                this.show_picture_(id, picture);
                return id;
            },
        };
        this.assistant_ = new Assistant({
            client: sdk.client,
            is_api_error: sdk.is_api_error,
            model: this.settings_.model,
            effort: this.settings_.effort,
            system: system_prompt(),
            tools: tools({ pictures: !!this.settings_.gemini_key }),
            run_tool: make_tool_runner(ctx),
            on_event: e => this.on_event_(e),
        });
        return this.assistant_;
    }

    async add_user_picture_(f) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const picture = { data: btoa(bin), mime_type: f.type || 'image/png', source: f.name };
        const id = `p${this.pictures_.size + 1}`;
        this.pictures_.set(id, picture);
        this.show_picture_(id, picture);
        this.pending_.push(id);
        this.add_('note', `Picture ${id} goes with your next message.`);
    }

    show_picture_(id, picture) {
        const img = el('img', { class: 'msg-picture', alt: `Picture ${id}: ${picture.source ?? ''}`, src: `data:${picture.mime_type};base64,${picture.data}` });
        const fig = el('figure', { class: 'msg picture' }, [img, el('figcaption', { text: `Picture ${id}` })]);
        this.log_.append(fig);
        this.log_.scrollTop = this.log_.scrollHeight;
    }

    on_event_(e) {
        if (e.type === 'text') {
            this.reply_ ??= this.add_('assistant', '');
            this.reply_.textContent += e.text;
            this.log_.scrollTop = this.log_.scrollHeight;
        } else if (e.type === 'status') {
            this.reply_ = null;
            this.add_('status', e.text);
        } else if (e.type === 'tool') {
            this.reply_ = null;
            this.tool_line_ = this.add_('tool', `${kToolWords[e.name] ?? e.name}...`);
        } else if (e.type === 'tool_done') {
            if (this.tool_line_) this.tool_line_.textContent = `${kToolWords[e.name] ?? e.name}: ${e.is_error ? 'did not work, retrying' : 'done'}`;
            this.tool_line_?.classList.toggle('bad', e.is_error);
        } else if (e.type === 'usage') {
            const u = e.usage;
            this.usage_.input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
            this.usage_.cache_read += u.cache_read_input_tokens ?? 0;
            this.usage_.output += u.output_tokens ?? 0;
            const k = n => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
            this.usage_line_.textContent = `Tokens: ${k(this.usage_.input)} in, ${k(this.usage_.cache_read)} from cache, ${k(this.usage_.output)} out`;
        }
    }

    // Sends a message with the current design attached. Resolves when the turn ends.
    async send(text) {
        text = String(text ?? '').trim();
        if (!text || this.running_) return;
        if (!this.settings_.claude_key && !globalThis.__lamina_ai_stand_in) {
            this.set_open(true);
            this.show_settings_(true);
            this.add_('note', 'Add your Claude API key first.');
            return;
        }
        this.input_.value = '';
        this.add_('user', text);
        this.reply_ = null;
        this.running_ = new AbortController();
        this.send_btn_.hidden = true;
        this.stop_btn_.hidden = false;
        try {
            const assistant = await this.assistant_for_();
            const content = [{ type: 'text', text }];
            // Pictures the user added since the last message, with their ids for trace_picture.
            for (const id of this.pending_.splice(0)) {
                const p = this.pictures_.get(id);
                content.push({ type: 'image', source: { type: 'base64', media_type: p.mime_type, data: p.data } }, { type: 'text', text: `That is picture ${id}, added by the user (${p.source}).` });
            }
            content.push({ type: 'text', text: `The design as it is now: ${JSON.stringify(design_summary(this.ctx_.design()))}` });
            const r = await assistant.send(content, { signal: this.running_.signal });
            if (r.reason === 'stopped') this.add_('note', 'Stopped. Changes made so far stay; undo them in the top bar.');
            else if (r.reason === 'refused') this.add_('note bad', `Claude declined this request${r.detail ? `: ${r.detail}` : ''}. Try wording it differently.`);
            else if (r.reason === 'round_cap') this.add_('note', 'That took many steps, so the assistant paused. Say "carry on" to continue.');
        } catch (err) {
            this.add_('note bad', this.explain_ ? this.explain_(err) : err.message);
        } finally {
            this.running_ = null;
            this.send_btn_.hidden = false;
            this.stop_btn_.hidden = true;
        }
    }
}
