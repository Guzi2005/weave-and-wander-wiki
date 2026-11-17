import json
import html
import re
import zipfile
from pathlib import Path
import sys
from urllib.parse import unquote
from xml.etree import ElementTree as ET

if len(sys.argv) != 2:
    raise SystemExit('Usage: python import-pattern-epub.py <path-to-epub>')
epub = Path(sys.argv[1])
root = Path(__file__).resolve().parent / 'public'
image_dir = root / 'assets' / 'patterns'
image_dir.mkdir(parents=True, exist_ok=True)
records = []

def text(node):
    return ' '.join(''.join(node.itertext()).split())

with zipfile.ZipFile(epub) as archive:
    chapters = sorted((name for name in archive.namelist() if re.search(r'Text/Chapter\d+\.xhtml$', name)))
    for index, name in enumerate(chapters, 1):
        chapter = ET.fromstring(html.unescape(archive.read(name).decode('utf-8')))
        body = next(node for node in chapter.iter() if node.tag.endswith('body'))
        heading = next((text(node) for node in body if node.tag.endswith('h1')), '')
        title = re.sub(r'^[^\s]+\s+', '', heading).strip() or heading
        if not title:
            continue
        media = []
        caption = '纹样概览'
        for node in body:
            if node.tag.endswith('h2'):
                caption = text(node)
            for image in node.iter():
                if not image.tag.endswith('img'):
                    continue
                source = 'OEBPS/Images/' + unquote(image.get('src', '').split('/')[-1])
                if source not in archive.namelist():
                    raise ValueError(f'Missing image: {source}')
                target = f'pattern-{index:03d}-{len(media)+1:02d}{Path(source).suffix.lower()}'
                (image_dir / target).write_bytes(archive.read(source))
                media.append({'path':f'/assets/patterns/{target}', 'role':'source', 'label':caption})
        records.append({
            'id':f'WW-PAT-{index:03d}', 'title':title, 'record_type':'object',
            'category':'纹样', 'status':'待考证', 'parent_id':None,
            'collection_id':'pattern_book_hqs_2021', 'culture':None,
            'place':None, 'date_text':None, 'observations':[],
            'source':{'author':'黄清穗', 'title':'中国经典纹样图鉴', 'year':'2021', 'record_id':'WW-BIB-HQS-2021', 'url':None, 'license':None},
            'media':media, 'revision':1,
        })

cover = 'OEBPS/Images/cover.jpg'
with zipfile.ZipFile(epub) as archive:
    (image_dir / 'book-hqs-2021-cover.jpg').write_bytes(archive.read(cover))
records.insert(0, {
    'id':'WW-BIB-HQS-2021', 'title':'中国经典纹样图鉴', 'record_type':'object',
    'category':'书目', 'status':'待整理', 'parent_id':None,
    'collection_id':'bibliography', 'culture':None, 'place':None,
    'date_text':'2021', 'observations':['本书收录的纹样在本站以独立条目整理，图例附在相应纹样条目内。'],
    'source':{'author':'黄清穗', 'title':'中国经典纹样图鉴', 'year':'2021', 'url':None, 'license':None},
    'media':[{'path':'/assets/patterns/book-hqs-2021-cover.jpg', 'role':'source', 'label':'《中国经典纹样图鉴》封面'}],
    'revision':1,
})
(root / 'library' / 'patterns.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'entries':len(records), 'images':sum(len(row['media']) for row in records), 'first':records[0]['title'], 'last':records[-1]['title']}, ensure_ascii=True))
