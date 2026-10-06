const test=require('node:test'),assert=require('node:assert/strict');
const {packageURL,validateOfficial}=require('../js/setup.cjs');
test('download validation keeps HTTPS verification and official host boundaries',()=>{
 assert.equal(validateOfficial('https://www.voidtools.com/downloads/').hostname,'www.voidtools.com');
 for(const url of ['http://www.voidtools.com/a','https://evil.example/a','https://www.voidtools.com:8443/a','https://user:pass@www.voidtools.com/a'])assert.throws(()=>validateOfficial(url));
 assert.throws(()=>validateOfficial('https://voidtools.com/a',5));
});
test('installer selects official stable portable package, not setup or beta',()=>{
 const html='<a href="/Everything-1.5.0.1423b.x64.zip">beta</a><a href="/Everything-1.4.1.1032.x64-Setup.exe">setup</a><a href="/Everything-1.4.1.1032.x64.zip">portable</a><a href="/ES-1.1.0.38.x64.zip">es</a>';
 assert.equal(packageURL(html,'Everything','x64'),'https://www.voidtools.com/Everything-1.4.1.1032.x64.zip');
 assert.equal(packageURL(html,'ES','x64'),'https://www.voidtools.com/ES-1.1.0.38.x64.zip');
 assert.throws(()=>packageURL(html,'ES','ARM64'));
});
