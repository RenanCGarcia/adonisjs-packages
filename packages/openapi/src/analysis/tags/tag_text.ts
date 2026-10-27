import ts from 'typescript'

export function jsDoc(node: ts.Node) {
  return ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1)
}

export function tagText(tag: ts.JSDocTag) {
  return ts.getTextOfJSDocComment(tag.comment)?.trim() ?? ''
}

export function reasonOf(text: string) {
  return text.replace(/\s*\n\s*/g, ' ').trim() || undefined
}

export function statusText(text: string) {
  return /^[1-5]\d\d$/.test(text) ? text : undefined
}

export function tagsOf(doc: ts.JSDoc | undefined) {
  const tag = doc?.tags?.find(candidate => candidate.tagName.text === 'tags')

  return (
    tag &&
    tagText(tag)
      .split(',')
      .map(name => name.trim())
      .filter(Boolean)
  )
}
