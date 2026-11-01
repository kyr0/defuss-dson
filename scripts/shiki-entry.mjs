// Entry of the website's syntax highlighter, bundled by scripts/site.mjs into docs/assets/lib/shiki.mjs.
// Why a vendored fine-grained bundle instead of Shiki from a CDN: only the four grammars and two themes the page
// uses ship, the JavaScript regex engine needs no WebAssembly download, and the page has no third-party script
// whose content could change under it. Why Shiki instead of a regex highlighter: it uses the TextMate grammars
// of VS Code, so tokens are coloured as in an editor.
// VERIFIED: the bundle is 519 kB minified (104 kB gzip), and two builds with bun 1.4.3 are byte-identical.
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import javascript from 'shiki/langs/javascript.mjs';
import html from 'shiki/langs/html.mjs';
import json from 'shiki/langs/json.mjs';
import shellscript from 'shiki/langs/shellscript.mjs';
import githubLight from 'shiki/themes/github-light.mjs';
import githubDark from 'shiki/themes/github-dark.mjs';

const highlighter = await createHighlighterCore({
  themes: [githubLight, githubDark],
  langs: [javascript, html, json, shellscript],
  engine: createJavaScriptRegexEngine(),
});

/**
 * Lines of tokens; each token carries both theme colours as CSS variables (--shiki-light, --shiki-dark), so the
 * page switches colours with its dark mode in CSS and never re-highlights.
 * @param {string} code
 * @param {'javascript'|'html'|'json'|'shellscript'} lang
 */
export const tokenize = (code, lang) =>
  highlighter.codeToTokens(code, { lang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false }).tokens;
