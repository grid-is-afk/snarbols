export interface TYPE_PROVIDER {
  id?: string;
  streaming?: boolean;
  responseContentPath?: string;
  isCustom?: boolean;
  curl: string;
  /**
   * Suggested default model ID. When a provider is selected and its `{{MODEL}}`
   * variable is still empty, the UI prefills this so a fresh setup works out of
   * the box. Optional — omit when no currently-valid default can be guaranteed.
   */
  defaultModel?: string;
  /**
   * Suggested model IDs for the model combobox. When present, the model field
   * renders as a datalist-backed combobox of these values; free-typed values
   * are always still allowed. Leave undefined to keep the field free-text.
   */
  models?: string[];
}
