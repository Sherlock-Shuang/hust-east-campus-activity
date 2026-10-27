import {readFile} from 'node:fs/promises';
import {createTursoDatabase} from './database.mjs';
let db;
try{
  db=createTursoDatabase(process.env);
  const sql=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
  await db.batch(sql.split(';').map(statement=>statement.trim()).filter(Boolean).map(statement=>db.prepare(statement)));
  console.log('Activity schema is ready. Existing records were preserved.');
}catch{
  console.error('Activity schema migration failed. Check Turso configuration and database permissions; credentials are not printed.');process.exitCode=1;
}finally{db?.close();}
