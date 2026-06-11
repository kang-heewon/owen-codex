import {
  OWX_MODELS_END_MARKER,
  OWX_MODELS_START_MARKER,
} from './agents-model-table.js'

export const OWX_GENERATED_AGENTS_MARKER = '<!-- owx:generated:agents-md -->'
export const OWX_MANAGED_AGENTS_START_MARKER = '<!-- OWX:AGENTS:START -->'
export const OWX_MANAGED_AGENTS_END_MARKER = '<!-- OWX:AGENTS:END -->'
export const OWX_AGENTS_CONTRACT_HEADING =
  '# owen-codex - Intelligent Multi-Agent Orchestration'
const OWX_AGENTS_CONTRACT_REQUIRED_TEXT = [
  OWX_GENERATED_AGENTS_MARKER,
  OWX_AGENTS_CONTRACT_HEADING,
  'AGENTS.md is the top-level operating contract for the workspace.',
] as const
const AUTONOMY_DIRECTIVE_END_MARKER = '<!-- END AUTONOMY DIRECTIVE -->'

export function isOmxGeneratedAgentsMd(content: string): boolean {
  return content.includes(OWX_GENERATED_AGENTS_MARKER)
}

export function hasOmxManagedAgentsSections(content: string): boolean {
  return (
    isOmxGeneratedAgentsMd(content) ||
    (content.includes(OWX_MANAGED_AGENTS_START_MARKER) &&
      content.includes(OWX_MANAGED_AGENTS_END_MARKER)) ||
    (content.includes(OWX_MODELS_START_MARKER) &&
      content.includes(OWX_MODELS_END_MARKER))
  )
}

export function hasOmxAgentsContract(content: string): boolean {
  if (candidateHasOmxAgentsContract(content)) return true

  const startIndex = content.indexOf(OWX_MANAGED_AGENTS_START_MARKER)
  const endIndex = content.indexOf(OWX_MANAGED_AGENTS_END_MARKER)
  if (startIndex === -1 || endIndex <= startIndex) return false

  const managedBlock = content.slice(
    startIndex + OWX_MANAGED_AGENTS_START_MARKER.length,
    endIndex,
  )
  return candidateHasOmxAgentsContract(managedBlock)
}

function candidateHasOmxAgentsContract(content: string): boolean {
  return OWX_AGENTS_CONTRACT_REQUIRED_TEXT.every((text) =>
    content.includes(text),
  )
}

export function upsertManagedAgentsBlock(
  existingContent: string,
  managedContent: string,
): string {
  const normalizedExisting = existingContent.endsWith('\n')
    ? existingContent
    : `${existingContent}\n`
  const normalizedManaged = managedContent.endsWith('\n')
    ? managedContent
    : `${managedContent}\n`
  const block = [
    OWX_MANAGED_AGENTS_START_MARKER,
    normalizedManaged.trimEnd(),
    OWX_MANAGED_AGENTS_END_MARKER,
  ].join('\n')

  const startIndex = normalizedExisting.indexOf(OWX_MANAGED_AGENTS_START_MARKER)
  const endIndex = normalizedExisting.indexOf(OWX_MANAGED_AGENTS_END_MARKER)

  if (startIndex >= 0 && endIndex > startIndex) {
    const replaceEnd = endIndex + OWX_MANAGED_AGENTS_END_MARKER.length
    const next = `${normalizedExisting.slice(0, startIndex)}${block}${normalizedExisting.slice(replaceEnd)}`
    return next.endsWith('\n') ? next : `${next}\n`
  }

  return `${normalizedExisting.trimEnd()}\n\n${block}\n`
}

export function addGeneratedAgentsMarker(content: string): string {
  if (content.includes(OWX_GENERATED_AGENTS_MARKER)) return content

  const autonomyDirectiveEnd = content.indexOf(AUTONOMY_DIRECTIVE_END_MARKER)
  if (autonomyDirectiveEnd >= 0) {
    const insertAt = autonomyDirectiveEnd + AUTONOMY_DIRECTIVE_END_MARKER.length
    const hasImmediateNewline = content[insertAt] === '\n'
    const insertionPoint = hasImmediateNewline ? insertAt + 1 : insertAt
    return (
      content.slice(0, insertionPoint) +
      `${OWX_GENERATED_AGENTS_MARKER}\n` +
      content.slice(insertionPoint)
    )
  }

  const firstNewline = content.indexOf('\n')
  if (firstNewline === -1) {
    return `${content}\n${OWX_GENERATED_AGENTS_MARKER}\n`
  }

  return (
    content.slice(0, firstNewline + 1) +
    `${OWX_GENERATED_AGENTS_MARKER}\n` +
    content.slice(firstNewline + 1)
  )
}
