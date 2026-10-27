/* Shared browser/server read-model presentation. No source-record fallback. */
(function(root){
  'use strict';
  function esc(v){return String(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function value(v){
    if(v==null || typeof v==='object' || typeof v==='function') return 'Unavailable';
    if(typeof v==='number' && !Number.isFinite(v)) return 'Unavailable';
    if(typeof v==='string' && /^\s*[\[{]/.test(v)) {try{JSON.parse(v);return 'Unavailable';}catch{if(/^\s*[\[{]\s*["\[{]/.test(v))return 'Unavailable';}}
    return esc(v);
  }
  function hidden(k){return /^(raw|raw_payload|payload|metadata|meta|debug|private_key|token|secret|credentials|authorization|commandQueue)$/i.test(k);}
  function table(obj){
    var rows=Object.keys(obj||{}).filter(function(k){return !hidden(k) && (obj[k]===null || ['string','number','boolean','bigint'].includes(typeof obj[k]));}).map(function(k){return '<tr><th>'+esc(k.replace(/_/g,' '))+'</th><td>'+value(obj[k])+'</td></tr>';});
    return rows.length?'<table><tbody>'+rows.join('')+'</tbody></table>':'<p>Values unavailable</p>';
  }
  function mediaKind(a){
    a=a||{};var name=String(a.file_name||''),mime=String(a.mime||'').split(';')[0].trim().toLowerCase();
    if(/(?:^|[\W_])(?:metadata|manifest|meta)(?:[\W_]|$)/i.test(name) || /\.(?:jsonl?|ndjson|map|ya?ml|xml|svg|html?|js)(?:$|[?#])/i.test(name) || /json|xml|javascript|html|svg/.test(mime)) return null;
    if(/^image\/(jpeg|png|gif|webp|avif|bmp)$/.test(mime) || /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(name)) return 'image';
    if(/^video\/(mp4|webm|quicktime|3gpp)$/.test(mime) || /\.(mp4|webm|mov|3gp)$/i.test(name)) return 'video';
    if(/^audio\//.test(mime) || /\.(mp3|ogg|opus|m4a|wav|aac|flac)$/i.test(name)) return 'audio';
    if(mime==='application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
    if(/\.(docx?|xlsx?|pptx?|odt|ods|odp|csv|txt|rtf|zip|7z|rar|gz|tar)$/i.test(name)) return 'document';
    return null;
  }
  function mediaSrc(a){return a && a.att_id && a.media_token?'/api/wa-media?att_id='+encodeURIComponent(a.att_id)+'&token='+encodeURIComponent(a.media_token):'';}
  function preview(a){
    var kind=mediaKind(a),src=mediaSrc(a);if(!kind)return '';if(!src)return '<p>File unavailable</p>';
    var url=esc(src),name=esc(a.file_name||'Document');
    if(kind==='image')return '<img loading="lazy" src="'+url+'" alt="'+name+'" style="max-width:100%">';
    if(kind==='audio'||kind==='video')return '<'+kind+' controls preload="none" src="'+url+'" style="max-width:100%"></'+kind+'>';
    return (kind==='pdf'?'<iframe loading="lazy" title="'+name+'" src="'+url+'" style="width:100%;height:360px;border:0"></iframe>':'')+'<a href="'+url+'" target="_blank" rel="noopener noreferrer">Open '+name+'</a>';
  }
  root.SectionPresentation=Object.freeze({esc:esc,value:value,table:table,hidden:hidden,mediaKind:mediaKind,mediaSrc:mediaSrc,preview:preview});
})(globalThis);
