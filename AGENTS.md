# AGENTS.md

Guidance for AI agents (and humans) working in this repository.

## What this project is

A build-time scanner for [DSPLAY HTML templates](https://developers.dsplay.tv/docs/html-templates) (the [DSPLAY - Digital Signage](https://dsplay.tv/) platform). It statically scans a template's source for its `dsplay_template` variable reads — `tval`/`tbval`/`tival`/`tfval` and `useTemplateVal`/`useTemplateBoolVal`/`useTemplateIntVal`/`useTemplateFloatVal` calls (from `@dsplay/template-utils`/`@dsplay/react-template-utils`, via either an ES import or the `dsplayTemplateUtils` global UMD alias), plus direct property access / destructuring off the template object (including a manually-parsed `JSON.parse(<...>.getData()).template`, see "Known scanner limitations" below) — and captures the template's `dsplay-data.js` mock as example preview data. The output is two JSON files a template ships inside its `template.zip`:

- `template-variables.json` — the detected `{key, type, default?, subtypeGuess?}` entries.
- `template-example-data.json` — the `{config, media, template}` example values from `dsplay-data.js`.

The CMS reads these to auto-detect a template's variables and seed default values for an in-browser preview, instead of requiring 100% manual registration.

## Directory structure

```
core.js          <-- the scanner itself: scanTemplateVariables, scanExampleData, generateManifest
vite-plugin.js    <-- thin Vite plugin wrapper (exports["./vite-plugin"]), for repos with a vite.config.js
cli.js            <-- CLI entry point (bin: dsplay-scan-template), for bundler-less/old-stack repos
```

This package deliberately lives on its own, separate from `@dsplay/template-utils` — putting it there would have forced `@babel/parser`/`@babel/traverse` (needed only by this scanner) onto every consumer of `template-utils`, including every React template via `@dsplay/react-template-utils`, none of which need this tool at runtime.

## How templates consume this

- Repos with a `vite.config.js` (e.g. `template-boilerplate-react`, `template-weather-forecast`): add as a `devDependency` and register the plugin from `@dsplay/template-manifest/vite-plugin` in `vite.config.js`. It writes the two JSON files into the build output directory on `closeBundle`, so they end up in `template.zip` alongside everything else.
- Repos with no bundler (`template-boilerplate-javascript`, `template-boilerplate-jquery`) or still on an older stack: invoke the `dsplay-scan-template` CLI (`--src`, `--dsplay-data`, `--out` flags) from a packaging script (e.g. `pack.sh`).

## Known scanner limitations

- **Genuinely unfixable: keys built from runtime content, not source-visible loop bounds.** `template-menuboard`'s `` template[`image${result[1]}`] `` reads `image1`..`image15` where `result[1]` comes from a regex match against the actual menu content a CMS user typed in (`/fi(3, 8)` markers) — there is no number to enumerate without executing the template against real data, which this scanner deliberately never does. Templates with this pattern must document those variables by hand instead (see that repo's README).
- **Fixed (1.0.4): manually-parsed `JSON.parse(<...>.getData())`.** Some bundler-less templates used to bypass `@dsplay/template-utils` entirely and parse the raw payload themselves (`var template = JSON.parse(DSPLAY.getData()).template; template.barColor`). Unlike the case above, this one *was* fixable — `isTemplateAccessBase()` (`core.js`) now also recognizes a `.template` read off anything that traces back to a `JSON.parse(<...>.getData())` call (see `isGetDataCall`/`resolvesToGetDataResult`), reusing the exact same downstream property-access/destructuring logic already used for the `useTemplate()`/global-UMD-alias cases — no loop-tracing or content-dependent enumeration needed, since the property name itself was always statically visible in source. Prefer migrating a template off this pattern (onto `useTemplateVal`/the `dsplayTemplateUtils` global's `tval`/`.template`) when you touch one, rather than leaning on this fallback — it exists for templates that haven't been migrated yet, not as an equally-good alternative.

## Commit messages

Every commit title must start with an emoji, followed by a short, imperative summary — e.g. `✨ add subtype guessing for color variables`.

- The human maintainer uses [gitmoji-cli](https://github.com/carloscuesta/gitmoji-cli) for manual commits, so gitmoji conventions (`✨` feature, `🐛` fix, `⬆️` upgrade deps, `♻️` refactor, `📝` docs, `🎨` structure/format) are a good default.
- Agents are not required to stick to the official gitmoji list — pick whichever emoji best represents the actual change in that commit, as long as it's placed at the start of the title.
