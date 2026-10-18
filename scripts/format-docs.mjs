// Small build-time renderer for our controlled Markdown reference. Raw HTML is
// escaped; only headings, paragraphs, lists, tables, inline code and fences are
// supported. No runtime dependency, fetch or executable document content.
export const escapeHtml=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const inline=text=>text.split(/(`[^`]+`)/).map(part=>part.startsWith('`')?`<code>${escapeHtml(part.slice(1,-1))}</code>`:escapeHtml(part).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')).join('');
export function renderFormatReference(markdown){
  const lines=markdown.trim().split(/\r?\n/),out=[];
  for(let i=0;i<lines.length;){
    const line=lines[i];if(!line.trim()){i++;continue;}
    if(line.startsWith('```')){
      const code=[];i++;while(i<lines.length&&!lines[i].startsWith('```'))code.push(lines[i++]);
      if(i===lines.length)throw Error('Unclosed native format code fence.');
      i++;out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);continue;
    }
    const heading=/^(#{1,3}) (.*)$/.exec(line);
    if(heading){const level=Math.min(heading[1].length+2,6);out.push(`<h${level}>${inline(heading[2])}</h${level}>`);i++;continue;}
    if(line.startsWith('|')){
      const rows=[];while(i<lines.length&&lines[i].startsWith('|'))rows.push(lines[i++]);
      const cells=row=>row.slice(1,-1).split('|').map(s=>inline(s.trim()));
      if(!/^\|(?:\s*-+\s*\|)+$/.test(rows[1]||''))throw Error('Invalid native format table.');
      out.push('<div class="format-table"><table><thead><tr>'+cells(rows[0]).map(s=>`<th scope="col">${s}</th>`).join('')+'</tr></thead><tbody>'+rows.slice(2).map(row=>'<tr>'+cells(row).map(s=>`<td>${s}</td>`).join('')+'</tr>').join('')+'</tbody></table></div>');continue;
    }
    if(/^\d+\. /.test(line)){
      const items=[];while(i<lines.length&&/^\d+\. /.test(lines[i]))items.push(`<li>${inline(lines[i++].replace(/^\d+\. /,''))}</li>`);
      out.push('<ol>'+items.join('')+'</ol>');continue;
    }
    if(line.startsWith('- ')){
      const items=[];while(i<lines.length&&lines[i].startsWith('- '))items.push(`<li>${inline(lines[i++].slice(2))}</li>`);
      out.push('<ul>'+items.join('')+'</ul>');continue;
    }
    const paragraph=[];while(i<lines.length&&lines[i].trim())paragraph.push(lines[i++]);
    out.push('<p>'+inline(paragraph.join(' '))+'</p>');
  }
  return out.join('\n');
}
