import {c118SeatId} from './c118-seating.js';
import {createC118Walkers,sampleC118AudiencePose} from './c118-audience-motion.js';

/** A deterministic virtual audience, separate from real participant identities.
 * Students share authored seated anatomy, with varied proportions and outfits.
 * Seated instances remain static; shared articulated parts animate only the
 * aisle walkers and, during flooding, the people lifted out of their chairs.
 */
export function createC118Audience(THREE,{plan}){
  const group=new THREE.Group();group.name='c118-seated-audience';
  const geometries=new Set(),materials=new Set(),batches=[],seatIndex=new Map();
  let disposed=false,hiddenSeat=null,lastTick=null,lastArgs=null,animationHz=25;
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
  function hash(id){let h=2166136261;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;h=Math.imul(h^(h>>>16),0x21f0aaad);h=Math.imul(h^(h>>>15),0x735a2d97);return (h^(h>>>15))>>>0;}
  // Keep the physical seats, but distribute small groups rather than drawing
  // an audience member in every chair. The room thins naturally toward the back.
  const occupied=[];
  for(let row=0;row<plan.config.rows;row++){
    const seats=plan.seats.filter(s=>s.row===row),progress=row/Math.max(1,plan.config.rows-1);
    const density=progress<.35?.68-.10*progress/.35:progress<.7?.44-.15*(progress-.35)/.35:.20-.12*(progress-.7)/.3;
    const count=Math.round(seats.length*density);
    const score=s=>hash(`group:${row}:${s.block}:${Math.floor(s.column/3)}`)/4294967296+hash(`seat:${c118SeatId(s)}`)/4294967296*.09;
    occupied.push(...seats.sort((a,b)=>score(a)-score(b)||a.column-b.column).slice(0,count));
  }
  const people=occupied.map((s,i)=>{const id=c118SeatId(s),seed=hash(id);seatIndex.set(id,i);
    const matrix=new THREE.Matrix4().compose(new THREE.Vector3(s.x,s.y,s.z-.018),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,((seed%17)-8)*.007,0)),new THREE.Vector3(.94+(seed%9)*.012,.975+((seed>>>5)%6)*.008,1));
    return {id,seed,matrix,seat:s,hair:seed%5<3?'short':seed%5===3?'long':'tied'};
  });
  function batch(name,geometry,palette,filter=()=>true){
    const members=people.map((p,i)=>({p,i})).filter(({p})=>filter(p)),mesh=new THREE.InstancedMesh(geometry,material(),members.length),lookup=new Map();
    mesh.name='c118-audience-'+name;mesh.castShadow=false;mesh.receiveShadow=false;
    for(let i=0;i<members.length;i++){const {p,i:person}=members[i];lookup.set(person,i);mesh.setMatrixAt(i,p.matrix);mesh.setColorAt(i,new THREE.Color(palette[(p.seed>>>3)%palette.length]));}
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);batches.push({mesh,lookup,members,palette});
  }
  batch('clothing',merge(coat),palettes.coat);batch('trousers',merge(pants),palettes.pants);batch('faces-hands',merge(skin),palettes.skin);batch('shoes',merge(shoes),palettes.shoes);batch('eyes',merge(details),['#342f2a']);
  for(const style of['short','long','tied'])batch('hair-'+style,hairCap(style),palettes.hair,p=>p.hair===style);
  const zero=new THREE.Matrix4().makeScale(0,0,0);
  const seatedVisible=people.map(()=>true),walkers=createC118Walkers(plan),allPeople=[...people,...walkers],movingBatches=[];
  function movingBatch(name,geometry,palette,multiplicity=1){
    const mesh=new THREE.InstancedMesh(geometry,material(),allPeople.length*multiplicity);
    geometries.add(geometry);mesh.name='c118-audience-moving-'+name;mesh.castShadow=false;mesh.receiveShadow=false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Bounds include every permitted pose; no per-frame bounding-sphere scan.
    mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,plan.config.height/2,0),Math.hypot(plan.config.width,plan.config.depth,plan.config.height)/2+2);
    const entry={mesh,palette,colors:allPeople.map(p=>new THREE.Color(palette[(p.seed>>>3)%palette.length])),owners:[],written:0};
    mesh.count=0;movingBatches.push(entry);group.add(mesh);return entry;
  }
  const torso=movingBatch('torso',merge([
    loft([[.51,.145,.105,.015],[.59,.15,.11,.015],[.74,.145,.105,.012],[.91,.165,.11,.016],[1.025,.185,.105,.014],[1.07,.155,.085,.01],[1.105,.075,.057,.005]],10),
    new THREE.TorusGeometry(.054,.01,4,10).rotateX(Math.PI/2).translate(0,1.101,0),
  ]).translate(0,-.58,0),palettes.coat);
  const pelvis=movingBatch('pelvis',merge([loft([[.49,.14,.095,0],[.58,.15,.105,0],[.64,.13,.085,0]],8)]).translate(0,-.58,0),palettes.pants);
  const movingSkin=[loft([[1.09,.046,.044,.001],[1.18,.046,.043,-.008]],8),loft(headProfile,10),ellipsoid(.019,.025,.024,[0,1.255,-.105],6,3)];
  for(const side of[-1,1])movingSkin.push(ellipsoid(.013,.025,.014,[side*.082,1.263,-.011],6,3));
  const heads=movingBatch('heads',merge(movingSkin).translate(0,-.58,0),palettes.skin);
  const eyes=movingBatch('eyes',merge([-1,1].map(side=>ellipsoid(.012,.006,.004,[side*.031,1.292,-.094],4,2))).translate(0,-.58,0),['#342f2a']);
  const hair={};for(const style of['short','long','tied'])hair[style]=movingBatch('hair-'+style,hairCap(style).translate(0,-.58,0),palettes.hair);
  const sleeves=movingBatch('sleeves',loft([[-.5,.72,.72,0],[-.43,1,1,0],[.37,.84,.84,0],[.5,.62,.62,0]],6),palettes.coat,4);
  const legs=movingBatch('legs',loft([[-.5,.78,.78,0],[-.43,1,1,0],[.37,.85,.85,0],[.5,.68,.68,0]],6),palettes.pants,4);
  const hands=movingBatch('hands',ellipsoid(.035,.058,.029,[0,0,0],7,4),palettes.skin,2);
  const feet=movingBatch('feet',ellipsoid(.061,.053,.127,[0,-.015,-.052],8,4),palettes.shoes,2);
  const root=new THREE.Matrix4(),local=new THREE.Matrix4(),matrix=new THREE.Matrix4(),point=new THREE.Vector3(),scale=new THREE.Vector3(1,1,1),direction=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),quaternion=new THREE.Quaternion(),identity=new THREE.Quaternion(),rotation=new THREE.Euler();
  function writePart(entry,person,transform){
    const i=entry.written++;entry.mesh.setMatrixAt(i,transform);
    if(entry.owners[i]!==person){entry.owners[i]=person;entry.mesh.setColorAt(i,entry.colors[person]);entry.colorChanged=true;}
  }
  function writeLimb(entry,person,a,b,radius){
    point.set((a[0]+b[0])*.5,(a[1]+b[1])*.5,(a[2]+b[2])*.5);direction.set(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
    const length=direction.length();quaternion.setFromUnitVectors(up,direction.multiplyScalar(1/Math.max(.001,length)));
    scale.set(radius,length,radius);local.compose(point,quaternion,scale);matrix.multiplyMatrices(root,local);writePart(entry,person,matrix);
  }
  function writeJoint(entry,person,at,orientation=identity){
    point.set(...at);scale.set(1,1,1);local.compose(point,orientation,scale);matrix.multiplyMatrices(root,local);writePart(entry,person,matrix);
  }
  function showSeat(id,shown){const person=seatIndex.get(id);if(person===undefined)return;for(const {mesh,lookup} of batches){const i=lookup.get(person);if(i===undefined)continue;mesh.setMatrixAt(i,shown&&seatedVisible[person]?people[person].matrix:zero);mesh.instanceMatrix.needsUpdate=true;}}
  function repackSeated(){
    // Remove lifted people from the submitted instance count instead of only
    // drawing zero-scale bodies, keeping the transition's vertex cost bounded.
    const color=new THREE.Color();
    for(const {mesh,lookup,members,palette} of batches){
      lookup.clear();let count=0;
      for(const {p,i:person} of members){if(!seatedVisible[person])continue;
        lookup.set(person,count);mesh.setMatrixAt(count,p.id===hiddenSeat?zero:p.matrix);
        mesh.setColorAt(count,color.set(palette[(p.seed>>>3)%palette.length]));count++;
      }
      mesh.count=count;mesh.visible=count>0;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    }
  }
  function update({time=0,elapsed=null,active=true,reducedMotion=false}={}){
    if(disposed||!active)return false;
    const clock=Number.isFinite(time)?time:0,floodTime=Number.isFinite(elapsed)?elapsed:null;
    const tick=`${floodTime===null?'dry':'flood'}:${Math.floor((floodTime??clock)*animationHz)}:${!!reducedMotion}`;
    if(tick===lastTick)return false;lastTick=tick;lastArgs={time:clock,elapsed:floodTime,active:true,reducedMotion};
    // A bounded pose budget is independent of the renderer's frame rate. Static
    // sitting instances upload only when someone enters/leaves the water.
    for(const entry of movingBatches){entry.written=0;entry.colorChanged=false;}
    let floatingCount=0,seatedCount=0,swimmingCount=0,divingCount=0,seatingChanged=false;
    for(let person=0;person<allPeople.length;person++){
      const p=allPeople[person],pose=!p.walker&&(floodTime===null||floodTime<1.5)?null:sampleC118AudiencePose(plan,p,lastArgs),sitting=!pose||pose.mode==='seated';
      if(person<people.length){
        if(seatedVisible[person]!==sitting){seatedVisible[person]=sitting;seatingChanged=true;}
        if(sitting)seatedCount++;
      }
      if(sitting||p.id===hiddenSeat)continue;
      if(pose.floating>.5)floatingCount++;
      if(pose.swimming>.5)swimmingCount++;
      if(pose.diving)divingCount++;
      point.set(pose.position.x,pose.position.y,pose.position.z);rotation.set(pose.rotation.x,pose.rotation.y,pose.rotation.z);quaternion.setFromEuler(rotation);
      scale.set(.94+(p.seed%9)*.012,.975+((p.seed>>>5)%6)*.008,1);root.compose(point,quaternion,scale);
      for(const entry of[torso,pelvis,heads,eyes,hair[p.hair]])writePart(entry,person,root);
      for(let side=0;side<2;side++){
        const j=pose.joints;
        writeLimb(sleeves,person,j.shoulders[side],j.elbows[side],.068);writeLimb(sleeves,person,j.elbows[side],j.wrists[side],.052);
        writeJoint(hands,person,j.wrists[side],quaternion);
        writeLimb(legs,person,j.hips[side],j.knees[side],.084);writeLimb(legs,person,j.knees[side],j.ankles[side],.06);
        writeJoint(feet,person,j.ankles[side]);
      }
    }
    if(seatingChanged)repackSeated();
    for(const entry of movingBatches){entry.mesh.count=entry.written;entry.mesh.visible=entry.written>0;
      // The allocated capacity includes all 217 people; normal dry movement
      // only uses the 14 aisle walkers. Upload the submitted prefix, not every
      // unused seat/limb slot. Static buffers are untouched unless seats change.
      entry.mesh.instanceMatrix.clearUpdateRanges();
      if(entry.written){entry.mesh.instanceMatrix.addUpdateRange(0,entry.written*16);entry.mesh.instanceMatrix.needsUpdate=true;}
      if(entry.colorChanged&&entry.mesh.instanceColor){entry.mesh.instanceColor.clearUpdateRanges();entry.mesh.instanceColor.addUpdateRange(0,entry.written*3);entry.mesh.instanceColor.needsUpdate=true;}
    }
    group.userData.walkingCount=walkers.length;group.userData.floatingCount=floatingCount;group.userData.seatedCount=seatedCount;
    group.userData.swimmingCount=swimmingCount;group.userData.divingCount=divingCount;
    return true;
  }
  group.userData={type:'virtual-audience',count:people.length,totalCount:allPeople.length,additionalDrawCalls:batches.length+movingBatches.length,seatIds:people.map(p=>p.id)};
  update({time:0});
  return {group,
    setPerformanceBudget({audienceHz=25}={}){const next=Math.max(8,Math.min(30,Number.isFinite(audienceHz)?audienceHz:25));if(next!==animationHz){animationHz=next;lastTick=null;}},
    setHiddenSeat(id){if(disposed)return;const next=seatIndex.has(id)?id:null;if(next===hiddenSeat)return;showSeat(hiddenSeat,true);showSeat(next,false);hiddenSeat=next;lastTick=null;if(lastArgs)update(lastArgs);},
    update,
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.clear();},
  };
}
