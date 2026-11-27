/**
 * Pure configuration-form rules for the vision tiler browser half.
 *
 * This module has no DOM, React, or DSH imports, so the form's field rules and
 * staged-edit fence can be tested without rendering. The browser half imports
 * the same functions the tests drive.
 */
/** The per-side request limit the Host applies to the overview. */
export declare const MAX_OVERVIEW_EDGE = 4096;
/** Control family for one configuration field. */
export type FieldKind = 'number' | 'integer' | 'boolean' | 'enum' | 'lines';
/** A staged control value: input text or a checkbox state. */
export type EditValue = string | boolean;
/** One parsed edit. */
export type ParsedField = {
    kind: 'set';
    value: unknown;
} | {
    kind: 'unset';
} | {
    kind: 'invalid';
};
/** One path-addressed settings write. */
export type SettingsOp = {
    op: 'set';
    path: string[];
    value: unknown;
} | {
    op: 'unset';
    path: string[];
};
/** The accepted Host values a form reads. */
export interface FormSnapshot {
    status: string;
    value: Record<string, unknown> | undefined;
    revision?: number;
}
/** One editable field and its local bounds. */
export interface FieldSpec {
    key: string;
    kind: FieldKind;
    min?: number;
    max?: number;
    options?: readonly string[];
}
/** Every field the form edits, in display order. */
export declare const FIELDS: readonly FieldSpec[];
/** Staged edits plus the revision fence captured at the first edit. */
export interface StagedForm {
    edits: Record<string, EditValue>;
    baseRevision: number | undefined;
    baseAccepted: Record<string, unknown> | null;
}
/** The untouched staged form. */
export declare const EMPTY_STAGED: StagedForm;
/**
 * Whether the reader has edited this field.
 * @param edits Staged values keyed by field.
 * @param key Field key.
 * @returns Whether the field is staged.
 */
export declare function isEdited(edits: Record<string, EditValue>, key: string): boolean;
/**
 * Format an accepted Host value for its control.
 * @param spec Field definition.
 * @param value Accepted value, or undefined when absent.
 * @returns Checkbox state, or input text.
 */
export declare function displayValue(spec: FieldSpec, value: unknown): EditValue;
/**
 * Parse one staged edit into a Host operation.
 * @param spec Field definition.
 * @param raw Staged text or checkbox state.
 * @returns A set/unset operation, or invalid.
 */
export declare function parseField(spec: FieldSpec, raw: EditValue): ParsedField;
/**
 * Build the ordered operations for the current edits.
 * @param edits Staged values keyed by field.
 * @returns Operations and whether any edit is invalid.
 */
export declare function editedOps(edits: Record<string, EditValue>): {
    ops: SettingsOp[];
    invalid: boolean;
};
/**
 * Whether two accepted field values are the same.
 * @param left First value.
 * @param right Second value.
 * @returns Whether they serialize identically.
 */
export declare function fieldEqual(left: unknown, right: unknown): boolean;
/**
 * Whether every edited field still holds the value it held when the fence was
 * captured, so an outside update can advance the fence without discarding the
 * draft.
 * @param keys Edited field keys.
 * @param base Accepted values at the fence.
 * @param current Accepted values now.
 * @returns Whether the fence may advance.
 */
export declare function acceptedUnchanged(keys: readonly string[], base: Record<string, unknown> | null, current: Record<string, unknown> | undefined): boolean;
/**
 * Stage one edit, capturing the revision fence on the first change.
 * @param state Current staged form.
 * @param key Field key.
 * @param value Staged value.
 * @param snapshot Accepted values at the time of the edit.
 * @returns The next staged form.
 */
export declare function stageEdit(state: StagedForm, key: string, value: EditValue, snapshot: FormSnapshot): StagedForm;
/**
 * Advance the fence when an outside update changed only fields the reader did
 * not edit; a changed edited field keeps the older fence so the save is
 * refused instead of overwriting the concurrent value.
 * @param state Current staged form.
 * @param snapshot Accepted values now.
 * @returns The next staged form.
 */
export declare function reconcileStaged(state: StagedForm, snapshot: FormSnapshot): StagedForm;
/**
 * Clear the staged form after an accepted save.
 * @returns A fresh untouched form.
 */
export declare function settleSaved(): StagedForm;
/**
 * Keep the staged edits after a refusal or failure and advance the fence to the
 * revision just read, so a retry is not refused for the same stale revision.
 * @param state Current staged form.
 * @param snapshot Accepted values now.
 * @returns The next staged form.
 */
export declare function settleFailed(state: StagedForm, snapshot: FormSnapshot): StagedForm;
//# sourceMappingURL=settings-form.d.ts.map