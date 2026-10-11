// Tiny zero-dependency ZIP writer (deflate) for in-memory entries.
import zlib from 'node:zlib';

function dosTime(d){
  const time=(d.getHours()<<11)|(d.getMinutes()<<5)|(Math.floor(d.getSeconds()/2));
  const date=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  return {time,date};
}

export function createZip(entries){
  const locals=[], centrals=[]; let offset=0;
  const {time,date}=dosTime(new Date());
  for(const e of entries){
    const name=Buffer.from(e.name,'utf8');
    const raw=Buffer.isBuffer(e.data)?e.data:Buffer.from(String(e.data),'utf8');
    const store=!!e.store;
    const comp=store?raw:zlib.deflateRawSync(raw,{level:6});
    const crc=zlib.crc32(raw)>>>0;
    const lh=Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50,0); lh.writeUInt16LE(20,4); lh.writeUInt16LE(0x0800,6); lh.writeUInt16LE(store?0:8,8);
    lh.writeUInt16LE(time,10); lh.writeUInt16LE(date,12); lh.writeUInt32LE(crc,14);
    lh.writeUInt32LE(comp.length,18); lh.writeUInt32LE(raw.length,22); lh.writeUInt16LE(name.length,26); lh.writeUInt16LE(0,28);
    locals.push(lh,name,comp);
    const ch=Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50,0); ch.writeUInt16LE(20,4); ch.writeUInt16LE(20,6); ch.writeUInt16LE(0x0800,8); ch.writeUInt16LE(store?0:8,10);
    ch.writeUInt16LE(time,12); ch.writeUInt16LE(date,14); ch.writeUInt32LE(crc,16); ch.writeUInt32LE(comp.length,20);
    ch.writeUInt32LE(raw.length,24); ch.writeUInt16LE(name.length,28); ch.writeUInt32LE(offset,42);
    centrals.push(ch,name);
    offset+=lh.length+name.length+comp.length;
  }
  const cd=Buffer.concat(centrals);
  const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(cd.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,cd,end]);
}
