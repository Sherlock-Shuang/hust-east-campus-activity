import {createClient} from '@libsql/client/web';

// Keep the proven SQLite CAS and conditional quota statements unchanged.
// Every execute is a primary-database operation; no embedded/local replica is
// used in production. The adapter exposes only the D1 subset used by this API.
export function adaptLibsql(client){
  const statements=new WeakMap();
  const normalize=result=>({results:result.rows.map(row=>Object.fromEntries(result.columns.map((name,index)=>[name,row[index]]))),meta:{changes:Number(result.rowsAffected||0)}});
  function prepare(sql,args=[]){
    const input={sql,args};
    const statement={
      bind(...values){return prepare(sql,values);},
      async first(column){const result=normalize(await client.execute(input)).results[0];return column?result?.[column]??null:result??null;},
      async all(){return normalize(await client.execute(input));},
      async run(){return normalize(await client.execute(input));},
    };
    statements.set(statement,input);return statement;
  }
  return {
    prepare,
    async batch(items){
      const input=items.map(item=>{const statement=statements.get(item);if(!statement)throw new Error('Invalid database statement');return statement;});
      return (await client.batch(input,'write')).map(normalize);
    },
    close(){client.close();},
  };
}
export function createTursoDatabase(env){
  const url=env.TURSO_DATABASE_URL,authToken=env.TURSO_AUTH_TOKEN;
  if(typeof url!=='string'||!url||typeof authToken!=='string'||!authToken)throw new Error('Turso database configuration is missing');
  // Marketplace provides libsql://; HTTPS avoids a persistent socket per
  // serverless invocation while retaining the same remote primary endpoint.
  const endpoint=new URL(url);if(!['libsql:','https:'].includes(endpoint.protocol))throw new Error('Turso requires a remote HTTPS/libSQL database');
  const remote=endpoint.protocol==='libsql:'?'https:'+url.slice('libsql:'.length):endpoint.href;
  return adaptLibsql(createClient({url:remote,authToken,intMode:'number'}));
}
