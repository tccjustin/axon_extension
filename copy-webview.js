const fs = require('fs');
const path = require('path');

const src = 'src/webview';
const dst = 'out/webview';

console.log('Creating directory:', dst);
fs.mkdirSync(dst, { recursive: true });

const files = fs.readdirSync(src);
console.log('Found files:', files.length);

files.forEach(f => {
    if (f.endsWith('.html') || f.endsWith('.css') || f.endsWith('.js')) {
        const srcPath = path.join(src, f);
        const dstPath = path.join(dst, f);
        console.log('Copying:', f);
        fs.copyFileSync(srcPath, dstPath);
    }
});

console.log('Done!');



