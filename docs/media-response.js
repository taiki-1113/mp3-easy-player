export function byteRange(header,size) {
  if (!header) return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1]&&!match[2])) return false;
  let start,end;
  if (!match[1]) {
    const suffix=Number(match[2]); if (!Number.isSafeInteger(suffix)||suffix<1) return false;
    start=Math.max(0,size-suffix);end=size-1;
  } else { start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1; }
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start ? {start,end} : false;
}
export function audioResponse(blob,rangeHeader,method='GET') {
  const headers={'Content-Type':'audio/mpeg','Accept-Ranges':'bytes','Cache-Control':'no-store'};
  const range=byteRange(rangeHeader,blob.size);
  if (range===false) return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${blob.size}`}});
  if (range) {
    headers['Content-Range']=`bytes ${range.start}-${range.end}/${blob.size}`;
    headers['Content-Length']=String(range.end-range.start+1);
    return new Response(method==='HEAD'?null:blob.slice(range.start,range.end+1,'audio/mpeg'),{status:206,headers});
  }
  headers['Content-Length']=String(blob.size);
  return new Response(method==='HEAD'?null:blob,{status:200,headers});
}
