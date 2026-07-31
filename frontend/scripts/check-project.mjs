import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const files = []
const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'])

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(vue|js)$/.test(entry.name)) files.push(full)
  }
}

function checkTemplateStack(file, text) {
  const match = text.match(/<template(?:\s[^>]*)?>([\s\S]*)<\/template>/)
  if (!match) return errors.push(`${path.relative(root, file)}: thiếu <template>`)
  const template = match[1]
  const stack = []
  let cursor = 0
  while (cursor < template.length) {
    const start = template.indexOf('<', cursor)
    if (start < 0) break
    if (template.startsWith('<!--', start)) {
      const end = template.indexOf('-->', start + 4)
      cursor = end < 0 ? template.length : end + 3
      continue
    }
    let quote = null
    let end = start + 1
    while (end < template.length) {
      const char = template[end]
      if (quote) {
        if (char === quote) quote = null
      } else if (char === '"' || char === "'") quote = char
      else if (char === '>') break
      end += 1
    }
    if (end >= template.length) {
      errors.push(`${path.relative(root, file)}: thẻ template chưa đóng`)
      return
    }
    const token = template.slice(start + 1, end).trim()
    cursor = end + 1
    if (!token || token.startsWith('!') || token.startsWith('?')) continue
    const closing = token.startsWith('/')
    const content = closing ? token.slice(1).trimStart() : token
    const tagMatch = content.match(/^([A-Za-z][\w.-]*)/)
    if (!tagMatch) continue
    const tag = tagMatch[1]
    const lower = tag.toLowerCase()
    const selfClosing = content.trimEnd().endsWith('/')
    if (closing) {
      const expected = stack.pop()
      if (!expected || expected.toLowerCase() !== lower) {
        errors.push(`${path.relative(root, file)}: đóng </${tag}> sai thứ tự${expected ? `, đang chờ </${expected}>` : ''}`)
        return
      }
    } else if (!voidTags.has(lower) && !selfClosing) stack.push(tag)
  }
  if (stack.length) errors.push(`${path.relative(root, file)}: còn thẻ chưa đóng ${stack.slice(-5).join(', ')}`)
}

walk(path.join(root, 'src'))
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(/(?:from\s+|import\()(['"])(\.{1,2}\/[^'"]+)\1/g)) {
    const raw = match[2]
    const base = path.resolve(path.dirname(file), raw)
    const candidates = [base, `${base}.js`, `${base}.vue`, path.join(base, 'index.js'), path.join(base, 'index.vue')]
    if (!candidates.some(fs.existsSync)) errors.push(`${path.relative(root, file)}: không tìm thấy import ${raw}`)
  }
  if (file.endsWith('.vue')) {
    const opens = (text.match(/<script/g) || []).length
    const closes = (text.match(/<\/script>/g) || []).length
    if (opens !== closes) errors.push(`${path.relative(root, file)}: script chưa đóng`)
    checkTemplateStack(file, text)
  }
}

const required = ['package.json','vite.config.js','index.html','src/main.js','src/App.vue','src/services/api.js','src/router.js']
for (const item of required) if (!fs.existsSync(path.join(root,item))) errors.push(`Thiếu ${item}`)
if (errors.length) {
  console.error('PROJECT_CHECK_FAILED')
  errors.forEach(error => console.error('-', error))
  process.exit(1)
}
console.log(`PROJECT_CHECK_OK: ${files.length} file source, import, script và template hợp lệ.`)
