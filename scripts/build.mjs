import {copyFile, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(projectRoot, 'public');
if (dirname(outputRoot) !== projectRoot || outputRoot === projectRoot) {
  throw new Error('Refusing to build outside the project public directory.');
}

const copied = [
  'reading.html',
  'reading-library.html',
  'reading-camp.html',
  'reading-session.html',
  'reading-notes.html',
  'reading.css',
  'reading-features.css',
  'reading-content.js',
  'reading-model.js',
  'reading-store.js',
  'reading-import.js',
  'reading-api.js',
  'reading-export.js'
];
const compiled = [
  'reading-preferences.jsx',
  'reading-art.jsx',
  'reading-discussion.jsx',
  'reading-extras.jsx',
  'reading-ui.jsx'
];

await rm(outputRoot, {recursive: true, force: true});
await mkdir(outputRoot, {recursive: true});

for (const name of copied) {
  await copyFile(join(projectRoot, name), join(outputRoot, name));
}

for (const name of compiled) {
  const source = await readFile(join(projectRoot, name), 'utf8');
  const result = await transform(source, {
    loader: 'jsx',
    jsx: 'transform',
    target: 'es2020',
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: false,
    legalComments: 'inline',
    sourcefile: name
  });
  await writeFile(join(outputRoot, name.replace(/\.jsx$/, '.js')), result.code);
}

await copyFile(join(projectRoot, 'node_modules/react/umd/react.production.min.js'), join(outputRoot, 'react.production.min.js'));
await copyFile(join(projectRoot, 'node_modules/react-dom/umd/react-dom.production.min.js'), join(outputRoot, 'react-dom.production.min.js'));

console.log(`Built ${copied.length + compiled.length + 2} browser assets in public/.`);
