# @dsplay/template-manifest

A build-time scanner for [DSPLAY HTML templates](https://developers.dsplay.tv/docs/html-templates) ([DSPLAY - Digital Signage](https://dsplay.tv/)).

It statically scans a template's source for its `dsplay_template` variable reads and captures its `dsplay-data.js` mock as example data, producing two JSON files a template ships inside its `template.zip`:

- **`template-variables.json`** — the detected variables, e.g.:
  ```json
  {
    "variables": [
      { "key": "title", "type": "string", "default": "Default Value" },
      { "key": "expanded", "type": "boolean", "default": true },
      { "key": "logo", "type": "string", "subtypeGuess": "image" }
    ]
  }
  ```
- **`template-example-data.json`** — the `{ config, media, template }` example values captured from `dsplay-data.js`.

The DSPLAY CMS reads these files to auto-detect a template's variables and seed default values for an in-browser preview, instead of requiring the variables to be registered by hand.

## What it detects

- `tval` / `tbval` / `tival` / `tfval` and `useTemplateVal` / `useTemplateBoolVal` / `useTemplateIntVal` / `useTemplateFloatVal` calls, imported from `@dsplay/template-utils` / `@dsplay/react-template-utils` **or** called off the `dsplayTemplateUtils` global UMD alias (`u.tval(...)`) used by bundler-less templates.
- Direct property access or destructuring off the template object, with no helper call at all — `template.title`, `useTemplate().title`, `const { title } = template`, `u.template.title` — including type promotion when wrapped in `parseInt`/`parseFloat`.
- A best-effort `default` value, resolved through local consts and chained `tval(...)`-as-default calls using each reference's own lexical scope (never a global cross-file lookup, since two files can legitimately use the same key with different local defaults). Defaults that are computed at runtime (e.g. `list.join(',')`) are left unresolved rather than guessed.
- A `subtypeGuess` (`image`, `video`, `color`) from the variable's key name, for `string`-typed variables — always a suggestion, never authoritative.

## Installation

```sh
npm install --save-dev @dsplay/template-manifest
```

## Usage

### Vite plugin

For templates built with Vite:

```js
// vite.config.js
import templateManifest from '@dsplay/template-manifest/vite-plugin';

export default defineConfig({
  plugins: [
    // ...
    templateManifest(),
  ],
});
```

It writes `template-variables.json` and `template-example-data.json` into the build output directory on `closeBundle`, so they end up inside `template.zip` alongside `index.html` and the rest of the build.

By default it scans `src` and reads `public/dsplay-data.js` (both resolved relative to the Vite root). Override with:

```js
templateManifest({ srcDir: 'source', dsplayDataPath: 'public/mock-data.js' });
```

### CLI

For templates with no bundler (e.g. the vanilla-js and jQuery boilerplates) or on an older build stack, run the `dsplay-scan-template` CLI from your packaging script (e.g. `pack.sh`):

```sh
npx dsplay-scan-template --src scripts --dsplay-data scripts/dsplay-data.js --out .
```

| Flag             | Default                 | Description                                  |
|------------------|--------------------------|-----------------------------------------------|
| `--src`          | `src`                    | Directory to scan recursively for `.js`/`.jsx` files |
| `--dsplay-data`  | `public/dsplay-data.js`  | Path to the template's `dsplay-data.js` mock  |
| `--out`          | `build`                  | Directory to write the two JSON files into    |

### Programmatic API

```js
import { scanTemplateVariables, scanExampleData, generateManifest } from '@dsplay/template-manifest';

const variables = scanTemplateVariables('src'); // [{key, type, default?, subtypeGuess?}]
const example = scanExampleData('public/dsplay-data.js'); // {config?, media?, template?}

generateManifest({ srcDir: 'src', dsplayDataPath: 'public/dsplay-data.js', outDir: 'build' });
```

## Why a separate package

This scanner depends on `@babel/parser`/`@babel/traverse`, which are only needed at build time by templates that opt into this tool. Bundling it inside `@dsplay/template-utils` would have forced those dependencies onto every consumer of that package — including every React template via `@dsplay/react-template-utils` — even though the vast majority never use the scanner.
