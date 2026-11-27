/**
 * Pure configuration-form rules for the vision tiler browser half.
 *
 * This module has no DOM, React, or DSH imports, so the form's field rules and
 * staged-edit fence can be tested without rendering. The browser half imports
 * the same functions the tests drive.
 */
/** The per-side request limit the Host applies to the overview. */
export const MAX_OVERVIEW_EDGE = 4096;
/** Every field the form edits, in display order. */
export const FIELDS = [
    { key: 'targetTilePixels', kind: 'integer', min: 16384 },
    { key: 'overlapRatio', kind: 'number', min: 0, max: 0.499 },
    { key: 'minOverlapPixels', kind: 'integer', min: 1 },
    { key: 'maxTotalTiles', kind: 'integer', min: 1 },
    { key: 'maxImagesPerBatch', kind: 'integer', min: 2 },
    { key: 'includeOverview', kind: 'boolean' },
    { key: 'overviewMaxEdge', kind: 'integer', min: 1, max: MAX_OVERVIEW_EDGE },
    { key: 'defaultStrategy', kind: 'enum', options: ['adaptive', 'uniform'] },
    { key: 'detailCropCount', kind: 'integer', min: 0, max: 16 },
    { key: 'detailCropSide', kind: 'integer', min: 256, max: 1024 },
    { key: 'models', kind: 'lines' },
];
/** The untouched staged form. */
export const EMPTY_STAGED = {
    edits: {},
    baseRevision: undefined,
    baseAccepted: null,
};
/**
 * Whether the reader has edited this field.
 * @param edits Staged values keyed by field.
 * @param key Field key.
 * @returns Whether the field is staged.
 */
export function isEdited(edits, key) {
    return Object.prototype.hasOwnProperty.call(edits, key);
}
/**
 * Format an accepted Host value for its control.
 * @param spec Field definition.
 * @param value Accepted value, or undefined when absent.
 * @returns Checkbox state, or input text.
 */
export function displayValue(spec, value) {
    if (spec.kind === 'boolean')
        return value === true;
    if (spec.kind === 'lines')
        return Array.isArray(value) ? value.join('\n') : '';
    if (spec.kind === 'enum')
        return typeof value === 'string' ? value : String(spec.options?.[0] ?? '');
    return typeof value === 'number' ? String(value) : '';
}
/**
 * Parse one staged edit into a Host operation.
 * @param spec Field definition.
 * @param raw Staged text or checkbox state.
 * @returns A set/unset operation, or invalid.
 */
export function parseField(spec, raw) {
    if (spec.kind === 'boolean')
        return { kind: 'set', value: raw === true };
    if (spec.kind === 'enum')
        return { kind: 'set', value: String(raw) };
    if (spec.kind === 'lines') {
        return {
            kind: 'set',
            value: String(raw).split('\n').map((line) => line.trim()).filter((line) => line !== ''),
        };
    }
    const text = String(raw).trim();
    if (text === '')
        return { kind: 'unset' };
    const value = Number(text);
    if (!Number.isFinite(value))
        return { kind: 'invalid' };
    if (spec.kind === 'integer' && !Number.isInteger(value))
        return { kind: 'invalid' };
    if (spec.min !== undefined && value < spec.min)
        return { kind: 'invalid' };
    if (spec.max !== undefined && value > spec.max)
        return { kind: 'invalid' };
    return { kind: 'set', value };
}
/**
 * Build the ordered operations for the current edits.
 * @param edits Staged values keyed by field.
 * @returns Operations and whether any edit is invalid.
 */
export function editedOps(edits) {
    const ops = [];
    for (const spec of FIELDS) {
        if (!isEdited(edits, spec.key))
            continue;
        const parsed = parseField(spec, edits[spec.key]);
        if (parsed.kind === 'invalid')
            return { ops: [], invalid: true };
        ops.push(parsed.kind === 'unset'
            ? { op: 'unset', path: [spec.key] }
            : { op: 'set', path: [spec.key], value: parsed.value });
    }
    return { ops, invalid: false };
}
/**
 * Whether two accepted field values are the same.
 * @param left First value.
 * @param right Second value.
 * @returns Whether they serialize identically.
 */
export function fieldEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
/**
 * Whether every edited field still holds the value it held when the fence was
 * captured, so an outside update can advance the fence without discarding the
 * draft.
 * @param keys Edited field keys.
 * @param base Accepted values at the fence.
 * @param current Accepted values now.
 * @returns Whether the fence may advance.
 */
export function acceptedUnchanged(keys, base, current) {
    if (base === null || current === undefined)
        return false;
    return keys.every((key) => fieldEqual(base[key], current[key]));
}
/**
 * Stage one edit, capturing the revision fence on the first change.
 * @param state Current staged form.
 * @param key Field key.
 * @param value Staged value.
 * @param snapshot Accepted values at the time of the edit.
 * @returns The next staged form.
 */
export function stageEdit(state, key, value, snapshot) {
    const edits = { ...state.edits, [key]: value };
    if (state.baseRevision !== undefined)
        return { ...state, edits };
    return { edits, baseRevision: snapshot.revision, baseAccepted: snapshot.value ?? null };
}
/**
 * Advance the fence when an outside update changed only fields the reader did
 * not edit; a changed edited field keeps the older fence so the save is
 * refused instead of overwriting the concurrent value.
 * @param state Current staged form.
 * @param snapshot Accepted values now.
 * @returns The next staged form.
 */
export function reconcileStaged(state, snapshot) {
    if (state.baseRevision === undefined)
        return state;
    if (snapshot.status !== 'ready' || snapshot.value === undefined || snapshot.revision === undefined)
        return state;
    if (snapshot.revision === state.baseRevision)
        return state;
    if (!acceptedUnchanged(Object.keys(state.edits), state.baseAccepted, snapshot.value))
        return state;
    return { ...state, baseRevision: snapshot.revision, baseAccepted: snapshot.value };
}
/**
 * Clear the staged form after an accepted save.
 * @returns A fresh untouched form.
 */
export function settleSaved() {
    return { edits: {}, baseRevision: undefined, baseAccepted: null };
}
/**
 * Keep the staged edits after a refusal or failure and advance the fence to the
 * revision just read, so a retry is not refused for the same stale revision.
 * @param state Current staged form.
 * @param snapshot Accepted values now.
 * @returns The next staged form.
 */
export function settleFailed(state, snapshot) {
    return { ...state, baseRevision: snapshot.revision, baseAccepted: snapshot.value ?? null };
}
//# sourceMappingURL=settings-form.js.map