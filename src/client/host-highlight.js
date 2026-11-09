/** Native Harness syntax highlighting, 0.2.2-rc.1 (MIT). See THIRD_PARTY_NOTICES.md.
 * Keep grammar aliases, theme tokens and bounded line scanning; no boot timer.
 */
import { createCssVariablesTheme, createHighlighterCoreSync } from '@shikijs/core';
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from '@shikijs/engine-javascript';
import langTs from '@shikijs/langs/typescript';
import langBash from '@shikijs/langs/shellscript';
import langJson from '@shikijs/langs/json';
const LANGS = [
	langTs,
	langBash,
	langJson
];
function patchGoGrammar(grammars) {
	const go = grammars.find((grammar) => grammar.name === "go");
	const fields = go?.repository.struct_variables_types_fields;
	const patterns = fields?.patterns ?? [];
	const rules = patterns.filter((rule) => typeof rule.match === "string" && rule.match.includes("[^\"/`\\s]+;?"));
	if (go === void 0 || fields === void 0 || rules.length !== 1) throw new Error(`ui-primitives: expected exactly one Go struct-field rule to patch for worlpaker/go-syntax#25, found ${rules.length}; update or delete the patch`);
	const repository = { ...go.repository };
	repository.struct_variables_types_fields = {
		...fields,
		patterns: patterns.map((rule) => rule === rules[0] ? {
			...rule,
			match: "(?:(?<=\\{)([^/\\`\"]*[^\\s/\\`\"])\\s*(?=\\}))"
		} : rule)
	};
	return grammars.map((grammar) => grammar === go ? {
		...go,
		repository
	} : grammar);
}
const LAZY_GRAMMARS = new Map([
	["python", () => import("@shikijs/langs/python")],
	["ruby", () => import("@shikijs/langs/ruby")],
	["go", async () => ({ default: patchGoGrammar((await import("@shikijs/langs/go")).default) })],
	["rust", () => import("@shikijs/langs/rust")],
	["java", () => import("@shikijs/langs/java")],
	["c", () => import("@shikijs/langs/c")],
	["cpp", () => import("@shikijs/langs/cpp")],
	["csharp", () => import("@shikijs/langs/csharp")],
	["kotlin", () => import("@shikijs/langs/kotlin")],
	["swift", () => import("@shikijs/langs/swift")],
	["php", () => import("@shikijs/langs/php")],
	["yaml", () => import("@shikijs/langs/yaml")],
	["toml", () => import("@shikijs/langs/toml")],
	["ini", () => import("@shikijs/langs/ini")],
	["markdown", () => import("@shikijs/langs/markdown")],
	["mdx", () => import("@shikijs/langs/mdx")],
	["html", () => import("@shikijs/langs/html")],
	["css", () => import("@shikijs/langs/css")],
	["scss", () => import("@shikijs/langs/scss")],
	["less", () => import("@shikijs/langs/less")],
	["sql", () => import("@shikijs/langs/sql")],
	["xml", () => import("@shikijs/langs/xml")],
	["lua", () => import("@shikijs/langs/lua")],
	["bat", () => import("@shikijs/langs/bat")],
	["powershell", () => import("@shikijs/langs/powershell")],
	["fish", () => import("@shikijs/langs/fish")],
	["dotenv", () => import("@shikijs/langs/dotenv")],
	["log", () => import("@shikijs/langs/log")],
	["csv", () => import("@shikijs/langs/csv")],
	["diff", () => import("@shikijs/langs/diff")],
	["http", () => import("@shikijs/langs/http")],
	["rst", () => import("@shikijs/langs/rst")],
	["latex", () => import("@shikijs/langs/latex")],
	["bibtex", () => import("@shikijs/langs/bibtex")],
	["asciidoc", () => import("@shikijs/langs/asciidoc")],
	["r", () => import("@shikijs/langs/r")],
	["julia", () => import("@shikijs/langs/julia")],
	["dart", () => import("@shikijs/langs/dart")],
	["scala", () => import("@shikijs/langs/scala")],
	["clojure", () => import("@shikijs/langs/clojure")],
	["erlang", () => import("@shikijs/langs/erlang")],
	["elixir", () => import("@shikijs/langs/elixir")],
	["haskell", () => import("@shikijs/langs/haskell")],
	["fsharp", () => import("@shikijs/langs/fsharp")],
	["vb", () => import("@shikijs/langs/vb")],
	["perl", () => import("@shikijs/langs/perl")],
	["verilog", () => import("@shikijs/langs/verilog")],
	["system-verilog", () => import("@shikijs/langs/system-verilog")],
	["graphql", () => import("@shikijs/langs/graphql")],
	["proto", () => import("@shikijs/langs/proto")],
	["hcl", () => import("@shikijs/langs/hcl")],
	["nix", () => import("@shikijs/langs/nix")],
	["vue", () => import("@shikijs/langs/vue")],
	["svelte", () => import("@shikijs/langs/svelte")],
	["make", () => import("@shikijs/langs/make")],
	["cmake", () => import("@shikijs/langs/cmake")],
	["groovy", () => import("@shikijs/langs/groovy")]
]);
const LANG_ALIASES = new Map([
	["typescript", "typescript"],
	["ts", "typescript"],
	["tsx", "typescript"],
	["javascript", "typescript"],
	["js", "typescript"],
	["jsx", "typescript"],
	["shellscript", "shellscript"],
	["bash", "shellscript"],
	["sh", "shellscript"],
	["shell", "shellscript"],
	["zsh", "shellscript"],
	["json", "json"],
	["jsonc", "json"],
	["py", "python"],
	["python", "python"],
	["rb", "ruby"],
	["ruby", "ruby"],
	["go", "go"],
	["rs", "rust"],
	["rust", "rust"],
	["java", "java"],
	["c", "c"],
	["cpp", "cpp"],
	["cs", "csharp"],
	["csharp", "csharp"],
	["kotlin", "kotlin"],
	["swift", "swift"],
	["php", "php"],
	["yaml", "yaml"],
	["yml", "yaml"],
	["toml", "toml"],
	["ini", "ini"],
	["md", "markdown"],
	["markdown", "markdown"],
	["mdx", "mdx"],
	["html", "html"],
	["css", "css"],
	["scss", "scss"],
	["less", "less"],
	["sql", "sql"],
	["xml", "xml"],
	["lua", "lua"],
	["bat", "bat"],
	["batch", "bat"],
	["powershell", "powershell"],
	["ps1", "powershell"],
	["ps", "powershell"],
	["fish", "fish"],
	["properties", "ini"],
	["dotenv", "dotenv"],
	["env", "dotenv"],
	["log", "log"],
	["csv", "csv"],
	["diff", "diff"],
	["patch", "diff"],
	["http", "http"],
	["rst", "rst"],
	["latex", "latex"],
	["tex", "latex"],
	["bibtex", "bibtex"],
	["bib", "bibtex"],
	["asciidoc", "asciidoc"],
	["adoc", "asciidoc"],
	["r", "r"],
	["julia", "julia"],
	["jl", "julia"],
	["dart", "dart"],
	["scala", "scala"],
	["clojure", "clojure"],
	["clj", "clojure"],
	["erlang", "erlang"],
	["erl", "erlang"],
	["elixir", "elixir"],
	["ex", "elixir"],
	["exs", "elixir"],
	["haskell", "haskell"],
	["hs", "haskell"],
	["fsharp", "fsharp"],
	["fs", "fsharp"],
	["fsi", "fsharp"],
	["fsx", "fsharp"],
	["vb", "vb"],
	["vbnet", "vb"],
	["perl", "perl"],
	["pl", "perl"],
	["pm", "perl"],
	["verilog", "verilog"],
	["v", "verilog"],
	["system-verilog", "system-verilog"],
	["systemverilog", "system-verilog"],
	["sv", "system-verilog"],
	["svh", "system-verilog"],
	["graphql", "graphql"],
	["gql", "graphql"],
	["proto", "proto"],
	["protobuf", "proto"],
	["hcl", "hcl"],
	["tf", "hcl"],
	["tfvars", "hcl"],
	["nix", "nix"],
	["vue", "vue"],
	["svelte", "svelte"],
	["make", "make"],
	["makefile", "make"],
	["mk", "make"],
	["cmake", "cmake"],
	["groovy", "groovy"],
	["gradle", "groovy"]
]);
function grammarForHint(lang) {
	return lang === void 0 ? void 0 : LANG_ALIASES.get(lang.toLowerCase());
}
export function supportsHighlighting(lang) {
  return grammarForHint(lang) !== undefined;
}
const cssVariablesTheme = createCssVariablesTheme({
	name: "css-variables",
	variablePrefix: "--shiki-",
	fontStyle: true
});
const regexEngine = createJavaScriptRegexEngine({
	forgiving: true,
	regexConstructor: (pattern) => defaultJavaScriptRegexConstructor(pattern, { lazyCompileLength: Number.POSITIVE_INFINITY })
});
const TOKENIZE_MAX_LINE_LENGTH = 1e3;
let singleton;
const BOOT_GRAMMAR_WARMUPS = [
	{
		lang: "typescript",
		code: "const answer: number = 42"
	},
	{
		lang: "shellscript",
		code: "printf '%s\\n' \"$HOME\""
	},
	{
		lang: "json",
		code: "{\"ready\":true}"
	}
];
function createHighlighter() {
	const instance = createHighlighterCoreSync({
		themes: [cssVariablesTheme],
		langs: LANGS,
		engine: regexEngine
	});
	for (const sample of BOOT_GRAMMAR_WARMUPS) instance.codeToTokens(sample.code, {
		lang: sample.lang,
		theme: "css-variables",
		tokenizeTimeLimit: 0
	});
	return instance;
}
function highlighter() {
	singleton ??= createHighlighter();
	return singleton;
}
const requested = /* @__PURE__ */ new Set();
const listeners = /* @__PURE__ */ new Set();
let loadCount = 0;
export function subscribeGrammarLoaded(listener) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
export function grammarLoadCount() {
	return loadCount;
}
function ensureGrammar(resolved) {
	const load = LAZY_GRAMMARS.get(resolved);
	if (load === void 0) return true;
	if (highlighter().getLoadedLanguages().includes(resolved)) return true;
	if (!requested.has(resolved)) {
		requested.add(resolved);
		load().then((mod) => {
			highlighter().loadLanguageSync(mod.default);
			loadCount += 1;
			for (const listener of listeners) listener();
		}).catch(() => { requested.delete(resolved); });
	}
	return false;
}

export function highlightTokens(code, language) {
  const resolved = grammarForHint(language);
  if (!resolved || !ensureGrammar(resolved)) return undefined;
  try {
    return highlighter().codeToTokens(code, { lang: resolved, theme: 'css-variables', tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH }).tokens;
  } catch { return undefined; }
}
