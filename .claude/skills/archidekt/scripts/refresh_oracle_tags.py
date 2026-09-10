#!/usr/bin/env python3
"""Regenerate references/oracle-tags-all.tsv from Scryfall.

Sources:
- Tagger (tagger.scryfall.com) has no public API; its single-page app talks to
  a GraphQL endpoint with a CSRF token embedded in any tag page. Paging
  through every ORACLE_CARD_TAG takes ~46 requests and gives each primary
  tag's slug, direct tagging count and description.
- https://scryfall.com/docs/tagger-tags is a single public page listing every
  functional tag as an `oracletag:` search link, INCLUDING aliases (old names
  like `tribal-elf`, `acceleration`). Slugs on that page but not in the Tagger
  catalogue are aliases.

Hierarchy columns (parent, descendant-inclusive count) and alias targets come
from a per-tag Tagger query that is throttled hard (~1/sec), so by default
they are kept from the previous TSV and only fetched for new tags. Pass
--hierarchy-top N to refetch the N biggest tags, or --hierarchy for all
(hours).

Usage:
    python3 refresh_oracle_tags.py
    python3 refresh_oracle_tags.py --hierarchy-top 300
"""
import argparse,http.cookiejar,json,os,re,sys,time,urllib.parse,urllib.request

UA='mtg-agent-table/1.0 (+https://github.com/artemlitch/mtg-agent-table)'
HERE=os.path.dirname(os.path.abspath(__file__))
TSV=os.path.join(HERE,'..','references','oracle-tags-all.tsv')
COLS=['slug','direct','with_descendants','parent','alias_of','description']

cj=http.cookiejar.CookieJar()
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def get(url):
    return opener.open(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=60).read().decode()

TOKEN=None
def gql(query,variables,op):
    global TOKEN
    TOKEN=TOKEN or re.search(r'name="csrf-token" content="([^"]+)"',get('https://tagger.scryfall.com/tags/card/removal')).group(1)
    body=json.dumps({'query':query,'variables':variables,'operationName':op}).encode()
    req=urllib.request.Request('https://tagger.scryfall.com/graphql',data=body,headers={
        'User-Agent':UA,'X-CSRF-Token':TOKEN,'Content-Type':'application/json','Accept':'application/json'})
    for _ in range(8):
        try: return json.load(opener.open(req,timeout=60))
        except urllib.error.HTTPError as e:
            if e.code==429: time.sleep(max(5,int(e.headers.get('Retry-After','10') or 10))); continue
            if e.code>=500: time.sleep(3); continue
            raise
    raise RuntimeError('gave up on '+op)

SEARCH='''query SearchTags($input: TagSearchInput!) { tags(input: $input) {
  page perPage total results { name slug description taggingCount } } }'''
FETCH='''query FetchTag($type: TagType!, $slug: String!) {
  tag: tagBySlug(type: $type, slug: $slug, aliasing: true) {
    slug ancestry { tag { slug } } taggings(page: 1, descendants: true) { total } } }'''

def catalogue():
    def page(p): return gql(SEARCH,{'input':{'name':'','type':'ORACLE_CARD_TAG','page':p}},'SearchTags')['data']['tags']
    first=page(1)
    pages=(first['total']+first['perPage']-1)//first['perPage']
    tags={t['slug']:t for t in first['results']}
    for p in range(2,pages+1):
        for t in page(p)['results']: tags[t['slug']]=t
        time.sleep(0.2)
    return tags

def public_page_slugs():
    html=get('https://scryfall.com/docs/tagger-tags')
    return set(urllib.parse.unquote(m) for m in re.findall(r'/search\?q=(?:oracletag|function)%3A([^"&]+)',html))

def fetch(slug):
    """-> (resolved_slug, parent, descendant_total). resolved_slug != slug means slug is an alias."""
    t=gql(FETCH,{'type':'ORACLE_CARD_TAG','slug':slug},'FetchTag')['data']['tag']
    if not t: return None
    parents=[a['tag']['slug'] for a in t['ancestry'] if a['tag']['slug']!=t['slug']]
    return t['slug'],(parents[-1] if parents else ''),t['taggings']['total']

def read_old():
    old={}
    if os.path.exists(TSV):
        with open(TSV) as f:
            hdr=next(f).rstrip('\n').split('\t')
            for line in f:
                row=dict(zip(hdr,line.rstrip('\n').split('\t')))
                old[row['slug']]=row
    return old

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--hierarchy',action='store_true')
    ap.add_argument('--hierarchy-top',type=int,default=0)
    a=ap.parse_args()
    old=read_old()
    tags=catalogue(); print('catalogue',len(tags),'primary tags',file=sys.stderr)
    page=public_page_slugs(); print('public page',len(page),'slugs',file=sys.stderr)
    aliases=sorted(page-set(tags))
    ordered=sorted(tags,key=lambda s:(-tags[s]['taggingCount'],s))
    todo=ordered if a.hierarchy else ordered[:a.hierarchy_top]
    todo+=[s for s in tags if s not in old]                                  # new primary tags
    todo+=[s for s in aliases if old.get(s,{}).get('alias_of','?') in ('?','')]  # unresolved aliases
    hier={}
    for i,s in enumerate(dict.fromkeys(todo)):
        try: hier[s]=fetch(s)
        except Exception as e: print('fetch fail',s,e,file=sys.stderr)
        if i%50==0: print('fetched',i,'/',len(todo),file=sys.stderr)
        time.sleep(1.0)
    rows=[]
    for s,t in tags.items():
        o=old.get(s,{}); h=hier.get(s)
        total,parent=(h[2],h[1]) if h else (o.get('with_descendants',''),o.get('parent',''))
        d=(t.get('description') or '').replace('\t',' ').replace('\n',' ').strip()
        rows.append({'slug':s,'direct':t['taggingCount'],'with_descendants':total,'parent':parent,'alias_of':'','description':d})
    rows.sort(key=lambda r:(-(int(r['with_descendants']) if str(r['with_descendants']).isdigit() else r['direct']),r['slug']))
    for s in aliases:
        h=hier.get(s)
        target=h[0] if h and h[0]!=s else old.get(s,{}).get('alias_of','?') or '?'
        rows.append({'slug':s,'direct':'','with_descendants':'','parent':'','alias_of':target,'description':'alias'})
    with open(TSV,'w') as f:
        f.write('\t'.join(COLS)+'\n')
        for r in rows: f.write('\t'.join(str(r[c]) for c in COLS)+'\n')
    print('wrote',TSV,len(tags),'primary +',len(aliases),'aliases',file=sys.stderr)

if __name__=='__main__': main()
