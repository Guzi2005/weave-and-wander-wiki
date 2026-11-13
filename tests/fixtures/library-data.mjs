import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadLibraryAssets} from '../../lib/library-assets.mjs';
const seed=JSON.parse(await readFile(new URL('../../seed/records.json',import.meta.url),'utf8'));
export default {records:seed.records,...await loadLibraryAssets(fileURLToPath(new URL('../../public',import.meta.url)))};
