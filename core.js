import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;

const HOOK_TYPES = {
  tval: 'string',
  useTemplateVal: 'string',
  tbval: 'boolean',
  useTemplateBoolVal: 'boolean',
  tival: 'integer',
  useTemplateIntVal: 'integer',
  tfval: 'float',
  useTemplateFloatVal: 'float',
};

// The global UMD build of @dsplay/template-utils exposes itself under this fixed name
// (see webpack.config.js's output.library) for templates with no bundler/import system at
// all (plain <script> tags, e.g. the vanilla-js and jQuery boilerplates).
const GLOBAL_UTILS_NAME = 'dsplayTemplateUtils';

const PACKAGE_NAMES = ['@dsplay/template-utils', '@dsplay/react-template-utils'];

const SOURCE_EXTENSIONS = ['.js', '.jsx'];

const IMAGE_NAME_HINT = /logo|image|background|bg[_-]|[_-]bg|icon|photo|picture|banner|thumbnail/i;
const VIDEO_NAME_HINT = /video/i;
const COLOR_NAME_HINT = /colou?r/i;

function guessSubtype(key, type) {
  if (type !== 'string') return undefined;
  if (VIDEO_NAME_HINT.test(key)) return 'video';
  // check color first: a literal "color"/"colour" substring is a more specific signal than
  // the generic bg_/_bg prefix IMAGE_NAME_HINT also matches (e.g. "bg_color_1", "bg_font_color")
  if (COLOR_NAME_HINT.test(key)) return 'color';
  if (IMAGE_NAME_HINT.test(key)) return 'image';
  return undefined;
}

function walkSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function parseFile(code) {
  return parse(code, {
    sourceType: 'unambiguous',
    plugins: ['jsx'],
  });
}

// Evaluates a "data literal" AST node (string/number/boolean/null/array/object of the same)
// into a plain JS value. Anything referencing identifiers/runtime globals is left undefined.
function evalLiteral(node) {
  if (!node) return undefined;
  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value;
    case 'NullLiteral':
      return null;
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'NumericLiteral') {
        return -node.argument.value;
      }
      return undefined;
    case 'ArrayExpression': {
      const arr = [];
      for (const el of node.elements) {
        if (el == null) { arr.push(null); continue; }
        const v = evalLiteral(el);
        if (v === undefined && el.type !== 'NullLiteral') return undefined;
        arr.push(v);
      }
      return arr;
    }
    case 'ObjectExpression': {
      const obj = {};
      for (const prop of node.properties) {
        if (prop.type !== 'ObjectProperty' || prop.computed) continue;
        const propKey = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
        const v = evalLiteral(prop.value);
        if (v === undefined && prop.value.type !== 'NullLiteral') continue;
        obj[propKey] = v;
      }
      return obj;
    }
    default:
      return undefined;
  }
}

function literalType(value) {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'float';
  if (typeof value === 'string') return 'string';
  return undefined;
}

// True when `node` is an Identifier that (directly, or via one or more local `var x = ...`
// indirections) refers to the dsplayTemplateUtils UMD global - or `window.dsplayTemplateUtils`.
function resolvesToGlobalUtilsAlias(node, scope, seen = new Set()) {
  if (!node) return false;
  if (node.type === 'Identifier') {
    if (node.name === GLOBAL_UTILS_NAME) return true;
    if (seen.has(node.name)) return false;
    const binding = scope.getBinding(node.name);
    const init = binding?.path?.isVariableDeclarator?.() ? binding.path.node.init : undefined;
    return init ? resolvesToGlobalUtilsAlias(init, scope, new Set(seen).add(node.name)) : false;
  }
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    return node.property.name === GLOBAL_UTILS_NAME;
  }
  return false;
}

// Returns the tval/tbval/tival/tfval "kind" a call's callee resolves to, whether reached via
// an ES import binding (`tval(...)`) or a member access off the global UMD alias (`u.tval(...)`).
function getHookType(callee, scope) {
  if (callee.type === 'Identifier') {
    const binding = scope.getBinding(callee.name);
    const importedName = binding?.path?.isImportSpecifier?.() ? binding.path.node.imported.name : undefined;
    return importedName ? HOOK_TYPES[importedName] : undefined;
  }
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    if (!resolvesToGlobalUtilsAlias(callee.object, scope)) return undefined;
    return HOOK_TYPES[callee.property.name];
  }
  return undefined;
}

// True when `node` is an expression representing "the template variables object" itself -
// covers the ES default export, the React `useTemplate()` hook result, and the global UMD
// alias's `.template` property (plus one level of local variable indirection for each).
function isTemplateAccessBase(node, scope, seen = new Set()) {
  if (!node) return false;

  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier'
      && node.property.name === 'template') {
    return resolvesToGlobalUtilsAlias(node.object, scope);
  }

  if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
    const binding = scope.getBinding(node.callee.name);
    const importedName = binding?.path?.isImportSpecifier?.() ? binding.path.node.imported.name : undefined;
    return importedName === 'useTemplate';
  }

  if (node.type === 'Identifier') {
    if (seen.has(node.name)) return false;
    const binding = scope.getBinding(node.name);
    if (!binding) return false;
    if (binding.path.isImportDefaultSpecifier?.()) {
      const importDecl = binding.path.parentPath;
      return PACKAGE_NAMES.includes(importDecl.node.source.value);
    }
    const init = binding.path.isVariableDeclarator?.() ? binding.path.node.init : undefined;
    return init ? isTemplateAccessBase(init, scope, new Set(seen).add(node.name)) : false;
  }

  return false;
}

// Descriptor for a var's default arg, resolved as far as static analysis allows by walking
// straight through the AST (local const references, chained tval(...)-as-default calls) using
// each node's own lexical scope — never through a global cross-file key lookup, since two
// different call sites can legitimately use the same key with different local defaults.
function describeDefault(node, scope, seen = new Set()) {
  if (!node) return { kind: 'none' };

  const literalValue = evalLiteral(node);
  if (literalValue !== undefined || node.type === 'NullLiteral') {
    return { kind: 'literal', value: literalValue };
  }

  if (node.type === 'CallExpression' && getHookType(node.callee, scope)) {
    // e.g. useTemplateVal('outer', useTemplateVal('inner')) - the outer's default is
    // whatever the inner reference itself resolves to as ITS OWN default.
    return describeDefault(node.arguments[1], scope, seen);
  }

  if (node.type === 'Identifier') {
    if (seen.has(node.name)) return { kind: 'unresolved' };
    const binding = scope.getBinding(node.name);
    const init = binding?.path?.isVariableDeclarator?.() ? binding.path.node.init : undefined;
    if (init) return describeDefault(init, scope, new Set(seen).add(node.name));
    return { kind: 'unresolved' };
  }

  return { kind: 'unresolved' };
}

function addVariable(table, key, type, { default: defaultValue, hasDefault = false } = {}) {
  const existing = table.get(key);
  if (existing) return existing;

  const variable = { key, type };
  if (hasDefault) variable.default = defaultValue;
  const subtype = guessSubtype(key, type);
  if (subtype) variable.subtypeGuess = subtype;
  table.set(key, variable);
  return variable;
}

function scanFile(code, table) {
  let ast;
  try {
    ast = parseFile(code);
  } catch {
    return;
  }

  traverse(ast, {
    // tval('key', default) / useTemplateVal('key', default) / u.tval('key', default)
    CallExpression(nodePath) {
      const { callee, arguments: args } = nodePath.node;
      const type = getHookType(callee, nodePath.scope);
      if (!type || args[0]?.type !== 'StringLiteral') return;

      const key = args[0].value;
      const defaultDescriptor = describeDefault(args[1], nodePath.scope);
      addVariable(table, key, type, {
        default: defaultDescriptor.kind === 'literal' ? defaultDescriptor.value : undefined,
        hasDefault: defaultDescriptor.kind === 'literal',
      });
    },

    // template.key / useTemplate().key / u.template.key (direct read, no helper call)
    MemberExpression(nodePath) {
      const node = nodePath.node;
      if (node.computed || node.property.type !== 'Identifier') return;
      if (!isTemplateAccessBase(node.object, nodePath.scope)) return;

      const key = node.property.name;
      let type = 'string';
      const parent = nodePath.parentPath;
      if (parent?.isCallExpression() && parent.node.arguments[0] === node
          && parent.node.callee.type === 'Identifier') {
        if (parent.node.callee.name === 'parseInt') type = 'integer';
        else if (parent.node.callee.name === 'parseFloat') type = 'float';
      }
      addVariable(table, key, type);
    },

    // const { key, other = 'default' } = template / useTemplate() / u.template
    VariableDeclarator(nodePath) {
      const node = nodePath.node;
      if (node.id.type !== 'ObjectPattern' || !isTemplateAccessBase(node.init, nodePath.scope)) return;

      for (const prop of node.id.properties) {
        if (prop.type !== 'ObjectProperty' || prop.computed) continue;
        const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;

        if (prop.value.type === 'AssignmentPattern') {
          const literalValue = evalLiteral(prop.value.right);
          const type = literalType(literalValue) || 'string';
          addVariable(table, key, type, { default: literalValue, hasDefault: literalValue !== undefined });
        } else {
          addVariable(table, key, 'string');
        }
      }
    },
  });
}

/**
 * Statically scans a template's source tree for DSPLAY template-variable reads
 * (`tval`/`useTemplateVal`-style calls, `useTemplate()`/`.template` destructuring or direct
 * property access, in both the ES-import and global-UMD-alias worlds) and returns the
 * discovered `{key, type, default?, subtypeGuess?}` entries.
 * @param {string} srcDir - Directory to scan recursively for .js/.jsx files.
 * @returns {Array<{key: string, type: 'string'|'boolean'|'integer'|'float', default?: *, subtypeGuess?: string}>}
 */
export function scanTemplateVariables(srcDir) {
  const table = new Map();
  for (const file of walkSourceFiles(srcDir)) {
    scanFile(readFileSync(file, 'utf-8'), table);
  }
  return [...table.values()];
}

function extractDsplayDataGlobal(ast, globalName) {
  let result;
  traverse(ast, {
    VariableDeclarator(nodePath) {
      if (nodePath.node.id.type === 'Identifier' && nodePath.node.id.name === globalName) {
        result = evalLiteral(nodePath.node.init);
      }
    },
  });
  return result;
}

/**
 * Captures a template's `dsplay-data.js` mock (`dsplay_config`/`dsplay_media`/`dsplay_template`)
 * as plain example data. Fields that aren't statically-evaluable literals (e.g. an `orientation`
 * computed from `window.innerWidth`) are silently dropped rather than poisoning the whole object.
 * @param {string} dsplayDataPath - Path to the template's dsplay-data.js file.
 * @returns {{config?: object, media?: object, template?: object}}
 */
export function scanExampleData(dsplayDataPath) {
  if (!existsSync(dsplayDataPath)) return {};

  const code = readFileSync(dsplayDataPath, 'utf-8');
  let ast;
  try {
    ast = parse(code, { sourceType: 'script' });
  } catch {
    return {};
  }

  const example = {};
  const config = extractDsplayDataGlobal(ast, 'dsplay_config');
  const media = extractDsplayDataGlobal(ast, 'dsplay_media');
  const template = extractDsplayDataGlobal(ast, 'dsplay_template');
  if (config) example.config = config;
  if (media) example.media = media;
  if (template) example.template = template;
  return example;
}

/**
 * Runs both scans and writes `template-variables.json` + `template-example-data.json` into
 * `outDir` (creating it if needed) - the pair of files a template's build should ship inside
 * its `template.zip` so the CMS can auto-detect variables and seed default preview values.
 * @param {{srcDir: string, dsplayDataPath: string, outDir: string}} options
 */
export function generateManifest({ srcDir, dsplayDataPath, outDir }) {
  const variables = scanTemplateVariables(srcDir);
  const example = scanExampleData(dsplayDataPath);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, 'template-variables.json'),
    `${JSON.stringify({ variables }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(outDir, 'template-example-data.json'),
    `${JSON.stringify(example, null, 2)}\n`,
  );

  return { variables, example };
}
