// Design store with undo and redo (SPEC 11): 80 steps. Edits that share a coalesce key within
// kCoalesceMs (one slider drag) become one undo step. Designs are immutable snapshots: an edit
// clones, mutates the clone, and replaces the current design.

export const kUndoDepth = 80;
const kCoalesceMs = 700;

export class Store {
    constructor(design, { now = () => Date.now() } = {}) {
        this.design_ = design;
        this.undo_ = [];
        this.redo_ = [];
        this.listeners_ = [];
        this.last_key_ = null;
        this.last_time_ = 0;
        this.now_ = now;
    }

    get design() {
        return this.design_;
    }

    subscribe(listener) {
        this.listeners_.push(listener);
    }

    // mutate(draft) edits a clone of the current design. coalesce_key joins rapid edits of the
    // same control into one undo step.
    update(mutate, { coalesce_key = null } = {}) {
        const draft = structuredClone(this.design_);
        mutate(draft);
        const t = this.now_();
        const join = coalesce_key !== null && coalesce_key === this.last_key_ && t - this.last_time_ < kCoalesceMs;
        if (!join) {
            this.undo_.push(this.design_);
            if (this.undo_.length > kUndoDepth) this.undo_.shift();
        }
        this.redo_ = [];
        this.last_key_ = coalesce_key;
        this.last_time_ = t;
        this.set_(draft);
    }

    // Replaces the whole design (open file, preset), as one undo step.
    replace(design) {
        this.update(draft => {
            for (const key of Object.keys(draft)) delete draft[key];
            Object.assign(draft, structuredClone(design));
        });
    }

    undo() {
        if (!this.undo_.length) return false;
        this.redo_.push(this.design_);
        this.last_key_ = null;
        this.set_(this.undo_.pop());
        return true;
    }

    redo() {
        if (!this.redo_.length) return false;
        this.undo_.push(this.design_);
        this.last_key_ = null;
        this.set_(this.redo_.pop());
        return true;
    }

    can_undo() {
        return this.undo_.length > 0;
    }

    can_redo() {
        return this.redo_.length > 0;
    }

    set_(design) {
        this.design_ = design;
        for (const listener of this.listeners_) listener(design);
    }
}
