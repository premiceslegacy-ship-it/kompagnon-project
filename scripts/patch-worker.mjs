#!/usr/bin/env node
// Retire l'import cloudflare/images.js du worker OpenNext généré.
// Ce module nécessite le plan Cloudflare Workers Paid — on le remplace par des stubs no-op.

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const workerPath = resolve('.open-next/worker.js')

let content = readFileSync(workerPath, 'utf-8')

// Remplace l'import par des stubs no-op
content = content.replace(
  /import \{ handleCdnCgiImageRequest, handleImageRequest \} from "\.\/cloudflare\/images\.js";/,
  `const handleCdnCgiImageRequest = () => new Response("Image optimization not available", { status: 501 });
const handleImageRequest = () => new Response("Image optimization not available", { status: 501 });`
)

writeFileSync(workerPath, content, 'utf-8')
console.log('✅ patch-worker: cloudflare/images.js remplacé par des stubs no-op')
