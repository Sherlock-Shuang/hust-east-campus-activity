// The local host shares the production SQL and game rules, with a local SQLite
// file instead of a remote database. Loaded only when someone opens a table.
import {DatabaseSync} from 'node:sqlite';
export function openGomokuDatabase(file){
  const sqlite=new DatabaseSync(file);sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const raw=new WeakMap();
  function prepare(sql,args=[]){
    const statement={bind:(...values)=>prepare(sql,values),async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return{results:sqlite.prepare(sql).all(...args)};},async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};
    raw.set(statement,{sql,args});return statement;
  }
  return {prepare,async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const out=statements.map(s=>{const {sql,args}=raw.get(s);return{meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};});sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}},close(){sqlite.close();}};
}
