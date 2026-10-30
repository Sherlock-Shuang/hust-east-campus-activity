import {c118SeatId} from './c118-seating.js';

/** A deterministic virtual audience, separate from real participant identities.
 * Students share authored seated anatomy, with varied proportions and outfits.
 * Static instances add no network/model download or per-frame animation work.
 */
export function createC118Audience(THREE,{plan}){
  const group=new THREE.Group();group.name='c118-seated-audience';
  const geometries=new Set(),materials=new Set(),batches=[],seatIndex=new Map();
  let disposed=false,hiddenSeat=null;
  const palettes={coat:['#344655','#a3b0aa','#9b705e','#d7d0ba','#655f6d','#466e70','#8a984c','#a79489','#34433f','#b18c68'],
    pants:['#353c44','#4b5559','#5c5a50','#293443','#6f7166'],skin:['#c89573','#dfb394','#b78363','#e3bea3','#cba487'],
    hair:['#242521','#352c26','#191e20','#493a30'],shoes:['#333936','#676b68','#bdbdb1']};
  function material(){const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.94});materials.add(m);return m;}
  function loft(rings,segments=10){
    const p=[],indices=[];
    for(const [y,rx,rz,z] of rings)for(let i=0;i<segments;i++){const a=i/segments*Math.PI*2;p.push(Math.cos(a)*rx,y,z+Math.sin(a)*rz);}
    for(let j=0;j<rings.length-1;j++)for(let i=0;i<segments;i++){const n=(i+1)%segments,a=j*segments+i,b=j*segments+n,c=(j+1)*segments+i,d=(j+1)*segments+n;indices.push(a,c,b,b,c,d);}
    for(const [ring,flip] of [[0,true],[rings.length-1,false]]){const center=p.length/3;p.push(0,rings[ring][0],rings[ring][3]);for(let i=0;i<segments;i++){const a=ring*segments+i,b=ring*segments+(i+1)%segments;indices.push(center,flip?a:b,flip?b:a);}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(indices);g.computeVertexNormals();return g;
  }
  const ellipsoid=(x,y,z,at,segments=8,rings=5)=>new THREE.SphereGeometry(1,segments,rings).scale(x,y,z).translate(...at);
  function limb(a,b,r0,r1){
    const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),v=bv.clone().sub(av),length=v.length();
    const g=loft([[-length/2,r0*.65,r0*.65,0],[-length/2+.025,r0,r0,0],[length/2-.025,r1,r1,0],[length/2,r1*.65,r1*.65,0]],6);
    const matrix=new THREE.Matrix4().compose(av.add(bv).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize()),new THREE.Vector3(1,1,1));return g.applyMatrix4(matrix);
  }
  function merge(parts){
    const positions=[],normals=[],indices=[];
    for(const part of parts){const p=part.getAttribute('position'),n=part.getAttribute('normal'),offset=positions.length/3;
      for(let i=0;i<p.count;i++){positions.push(p.getX(i),p.getY(i),p.getZ(i));normals.push(n.getX(i),n.getY(i),n.getZ(i));}
      if(part.index)for(let i=0;i<part.index.count;i++)indices.push(offset+part.index.getX(i));else for(let i=0;i<p.count;i++)indices.push(offset+i);
      part.dispose();
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(indices);g.computeBoundingSphere();geometries.add(g);return g;
  }
  const coat=[loft([[.51,.145,.105,.015],[.59,.15,.11,.015],[.74,.145,.105,.012],[.91,.165,.11,.016],[1.025,.185,.105,.014],[1.07,.155,.085,.01],[1.105,.075,.057,.005]],10)];
  const pants=[loft([[.49,.14,.095,0],[.58,.15,.105,0],[.64,.13,.085,0]],8)];
  const headProfile=[[1.155,.035,.043,-.036],[1.18,.055,.06,-.033],[1.235,.078,.077,-.024],[1.29,.083,.081,-.017],[1.34,.075,.076,-.009],[1.385,.042,.045,-.004],[1.397,.012,.016,-.004]];
  const skin=[loft([[1.09,.046,.044,.001],[1.18,.046,.043,-.008]],8),
    // Jaw, cheekbone, brow and skull contours; the head is not a spherical marker.
    loft(headProfile,10),
    ellipsoid(.019,.025,.024,[0,1.255,-.105],6,3)];
  const shoes=[],details=[];
  for(const side of[-1,1]){
    coat.push(limb([side*.168,1.025,.012],[side*.208,.79,-.073],.068,.057),limb([side*.208,.79,-.073],[side*.118,.655,-.225],.055,.037));
    pants.push(limb([side*.087,.565,-.005],[side*.095,.485,-.335],.088,.067),limb([side*.095,.485,-.335],[side*.098,.135,-.35],.063,.043));
    skin.push(ellipsoid(.034,.024,.057,[side*.112,.644,-.249],7,4),ellipsoid(.013,.025,.014,[side*.082,1.263,-.011],6,3));
    shoes.push(ellipsoid(.061,.053,.127,[side*.098,.055,-.403],8,4));
    // Restrained dark eyes are visible from the stage and unobtrusive from seats.
    details.push(ellipsoid(.012,.006,.004,[side*.031,1.292,-.094],4,2));
  }
  const collar=new THREE.TorusGeometry(.054,.01,4,10).rotateX(Math.PI/2).translate(0,1.101,0);coat.push(collar);
  function hairCap(style){
    // Share every skull cross-section and angular edge with the head. An
    // unrelated ellipsoid intersects the cheek/skull loft and exposes skin
    // stripes through the back of the hair, especially from a seated camera.
    const p=[],indices=[],segments=10,levels=[1.18,1.235,1.29,1.34,1.385,1.397,1.405];
    function skullAt(y){
      for(let j=1;j<headProfile.length;j++)if(y<=headProfile[j][0]){
        const a=headProfile[j-1],b=headProfile[j],t=(y-a[0])/(b[0]-a[0]);
        return [a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t,a[3]+(b[3]-a[3])*t];
      }
      return headProfile.at(-1).slice(1);
    }
    for(const level of levels)for(let i=0;i<segments;i++){
      const phi=i/segments*Math.PI*2,front=Math.max(0,-Math.sin(phi));
      const hairline=1.205+.115*Math.pow(front,.8)+.035*Math.abs(Math.cos(phi));
      const y=Math.max(level,hairline),[rx,rz,z]=skullAt(y);
      p.push((rx+.009)*Math.cos(phi),y,z+(rz+.009)*Math.sin(phi));
    }
    function triangle(a,b,c){
      const ax=p[b*3]-p[a*3],ay=p[b*3+1]-p[a*3+1],az=p[b*3+2]-p[a*3+2];
      const bx=p[c*3]-p[a*3],by=p[c*3+1]-p[a*3+1],bz=p[c*3+2]-p[a*3+2];
      if(Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx)>1e-9)indices.push(a,b,c);
    }
    for(let r=0;r<levels.length-1;r++)for(let i=0;i<segments;i++){
      const a=r*segments+i,b=r*segments+(i+1)%segments,c=(r+1)*segments+i,d=(r+1)*segments+(i+1)%segments;
      triangle(a,c,b);triangle(b,c,d);
    }
    const crown=p.length/3;p.push(0,1.412,headProfile.at(-1)[3]);
    for(let i=0;i<segments;i++)triangle(crown,(levels.length-1)*segments+(i+1)%segments,(levels.length-1)*segments+i);
    const cap=new THREE.BufferGeometry();cap.setAttribute('position',new THREE.Float32BufferAttribute(p,3));cap.setIndex(indices);cap.computeVertexNormals();const parts=[cap];
    if(style==='long')parts.push(loft([[1.025,.077,.026,.061],[1.09,.093,.039,.074],[1.20,.084,.043,.073],[1.30,.078,.035,.063]],10));
    if(style==='tied')parts.push(ellipsoid(.039,.097,.034,[.014,1.202,.107],8,5),ellipsoid(.039,.03,.03,[.014,1.285,.094],8,4));
    return merge(parts);
  }
  function hash(id){let h=2166136261;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h;}
  const people=plan.seats.map((s,i)=>{const id=c118SeatId(s),seed=hash(id);seatIndex.set(id,i);
    const matrix=new THREE.Matrix4().compose(new THREE.Vector3(s.x,s.y,s.z-.018),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,((seed%17)-8)*.007,0)),new THREE.Vector3(.94+(seed%9)*.012,.975+((seed>>>5)%6)*.008,1));
    return {id,seed,matrix,hair:seed%5<3?'short':seed%5===3?'long':'tied'};
  });
  function batch(name,geometry,palette,filter=()=>true){
    const members=people.map((p,i)=>({p,i})).filter(({p})=>filter(p)),mesh=new THREE.InstancedMesh(geometry,material(),members.length),lookup=new Map();
    mesh.name='c118-audience-'+name;mesh.castShadow=false;mesh.receiveShadow=false;
    for(let i=0;i<members.length;i++){const {p,i:person}=members[i];lookup.set(person,i);mesh.setMatrixAt(i,p.matrix);mesh.setColorAt(i,new THREE.Color(palette[(p.seed>>>3)%palette.length]));}
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);batches.push({mesh,lookup});
  }
  batch('clothing',merge(coat),palettes.coat);batch('trousers',merge(pants),palettes.pants);batch('faces-hands',merge(skin),palettes.skin);batch('shoes',merge(shoes),palettes.shoes);batch('eyes',merge(details),['#342f2a']);
  for(const style of['short','long','tied'])batch('hair-'+style,hairCap(style),palettes.hair,p=>p.hair===style);
  const zero=new THREE.Matrix4().makeScale(0,0,0);
  function showSeat(id,shown){const person=seatIndex.get(id);if(person===undefined)return;for(const {mesh,lookup} of batches){const i=lookup.get(person);if(i===undefined)continue;mesh.setMatrixAt(i,shown?people[person].matrix:zero);mesh.instanceMatrix.needsUpdate=true;}}
  group.userData={type:'virtual-audience',count:people.length,additionalDrawCalls:batches.length,seatIds:people.map(p=>p.id)};
  return {group,
    setHiddenSeat(id){if(disposed)return;const next=seatIndex.has(id)?id:null;if(next===hiddenSeat)return;showSeat(hiddenSeat,true);showSeat(next,false);hiddenSeat=next;},
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.clear();},
  };
}
