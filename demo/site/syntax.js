// Build-only entry. The browser loads the bundled copy on first use.
import { tokenize as json } from '@twinkleplop/json';
import { tokenize as bash } from '@twinkleplop/bash';
const tokenizers = { json: json(), bash: bash() };
export function tokenize(source, language) { return tokenizers[language]?.(source); }
