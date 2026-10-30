import test from 'node:test';
import assert from 'node:assert/strict';
import {installBrowserCompatibility,createClientId} from '../src/browser-compat.js';
import vm from 'node:vm';

test('older mobile APIs are filled before scene imports without replacing native implementations',()=>{
  const context=vm.createContext({});
  const {A,O}=vm.runInContext('delete Array.prototype.at;delete Object.hasOwn;({A:Array,O:Object})',context);
  installBrowserCompatibility({ArrayType:A,ObjectType:O});
  const a=vm.runInContext('["north","south"]',context);
  assert.equal(a.at(-1),'south');assert.equal(a.at(-2),'north');assert.equal(a.at(2),undefined);assert.equal(a.at(Infinity),undefined);assert.equal(a.at(-Infinity),undefined);assert.equal(a.at(NaN),'north');
  assert.equal(O.hasOwn(Object.create({inherited:1}),'inherited'),false);assert.equal(O.hasOwn({value:0},'value'),true);assert.equal(O.hasOwn(Object.create(null),'x'),false);assert.throws(()=>O.hasOwn(null,'x'),TypeError);
  assert.equal(Object.getOwnPropertyDescriptor(A.prototype,'at').enumerable,false);
  const at=A.prototype.at,own=O.hasOwn;installBrowserCompatibility({ArrayType:A,ObjectType:O});assert.equal(A.prototype.at,at);assert.equal(O.hasOwn,own);
});
test('secure client identifiers work when randomUUID is absent in an embedded browser',()=>{
  let seed=0;const crypto={getRandomValues(bytes){for(let i=0;i<bytes.length;i++)bytes[i]=seed++;return bytes;}};
  const a=createClientId(crypto),b=createClientId(crypto);
  assert.match(a,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.notEqual(a,b);
  assert.equal(createClientId({randomUUID:()=> 'native-id'}),'native-id');
  assert.throws(()=>createClientId({}),/HTTPS/);
});
