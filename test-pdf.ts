import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const _p = require('pdf-parse');

console.log('require("pdf-parse") gives:', Object.keys(_p), typeof _p);
console.log('PDFParse type:', typeof _p.PDFParse);
try {
    const instance = new _p.PDFParse(Buffer.from([]));
    console.log('Successfully created instance with new _p.PDFParse()');
} catch (e) {
    console.log('Failed to create instance with new _p.PDFParse():', e.message);
}

try {
    const result = _p.PDFParse(Buffer.from([]));
    console.log('Successfully called _p.PDFParse() as function');
} catch (e) {
    console.log('Failed to call _p.PDFParse() as function:', e.message);
}


