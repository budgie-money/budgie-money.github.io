// Build the single-file Apps Script deployment from the same sources the tests run.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const engine = read('engine.js'), version = engine.match(/var VERSION = "([^"]+)"/)[1];
const source = '// Budgie backend: one file. Built from engine.js (' + version + '), apps-script/Code.gs, Prices.gs, BankFeeds.gs and Extras.gs.\n' +
  '// The old sheets were moved in already, so the one-off import (importData) isn\'t included.\n\n' +
  engine + '\n\n' + read('apps-script/Code.gs') + '\n\n' +
  '// ---------- Prices.gs ----------\n' + read('apps-script/Prices.gs') + '\n\n' +
  '// ---------- BankFeeds.gs ----------\n' + read('apps-script/BankFeeds.gs') + '\n\n' +
  '// ---------- Extras.gs ----------\n' + read('apps-script/Extras.gs') + '\n';
new vm.Script(source, {filename: 'Code.gs'});
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'apps-script/Budgie.gs');
fs.writeFileSync(target, source);
console.log('Budgie ' + version + ' backend built: ' + target);
console.log('SHA-256 ' + crypto.createHash('sha256').update(source).digest('hex'));
