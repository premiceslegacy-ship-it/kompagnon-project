import postcss from 'postcss'

const PALETTE = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)'
const COLOR_PREFIX = '(?:bg|text|border(?:-[trblsexy])?|divide|ring|ring-offset|outline|shadow|fill|stroke|decoration|accent|caret|placeholder|from|via|to)'
const PALETTE_UTILITY = new RegExp(`^${COLOR_PREFIX}-${PALETTE}(?:-(?:50|100|200|300|400|500|600|700|800|900|950))?(?:/(?:\\d{1,3}|\\[[^\\]]+\\]))?$`, 'i')
const RAW_HEX_COLOR = /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b/i
const RAW_COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?!var\(--|from\s+var\(--)/i
const CSS_NAMED_COLORS = '(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)'
const RAW_NAMED_COLOR = new RegExp(`(?:^|[\\s,(])${CSS_NAMED_COLORS}(?=$|[\\s),/])`, 'i')
const ARBITRARY_NAMED_COLOR = new RegExp(`^${COLOR_PREFIX}-\\[${CSS_NAMED_COLORS}\\]$`, 'i')
const COLOR_ATTRIBUTES = new Set(['color', 'fill', 'stroke', 'stopColor', 'floodColor', 'lightingColor'])


const CSS_COLOR_PROPERTIES = new Set([
  'accent-color', 'background', 'background-color', 'background-image',
  'border', 'border-block', 'border-block-color', 'border-block-end', 'border-block-end-color',
  'border-block-start', 'border-block-start-color', 'border-bottom', 'border-bottom-color',
  'border-color', 'border-inline', 'border-inline-color', 'border-inline-end',
  'border-inline-end-color', 'border-inline-start', 'border-inline-start-color',
  'border-left', 'border-left-color', 'border-right', 'border-right-color',
  'border-top', 'border-top-color', 'box-shadow', 'caret-color', 'color',
  'column-rule', 'column-rule-color', 'fill', 'filter', 'flood-color', 'lighting-color',
  'outline', 'outline-color', 'stop-color', 'stroke', 'text-decoration',
  'text-decoration-color', 'text-emphasis', 'text-emphasis-color', 'text-shadow',
  '-webkit-text-fill-color', '-webkit-text-stroke', '-webkit-text-stroke-color',
])
const CSS_COLOR_COMPOSITION = /(?:color-mix|(?:repeating-)?(?:linear|radial|conic)-gradient)\s*\(/i
const CSS_NON_COLOR_CUSTOM_PROPERTY = /(?:^|[-_])(?:content|family|font|name)(?:$|[-_])/i
const CSS_COLOR_CUSTOM_PROPERTY = /(?:^|[-_])(?:accent|background|border|color|fill|foreground|stroke|surface|text|tint)(?:$|[-_])/i
const cssMessagesByFilename = new Map()


function isCssUrlFunction(value, index) {
  const previous = value[index - 1]
  return value.slice(index, index + 3).toLowerCase() === 'url' &&
    (!previous || !/[\w-]/.test(previous)) &&
    value[index + 3] === '('
}

function skipCssFunction(value, start) {
  let depth = 0
  let quote = ''

  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = ''
      continue
    }
    if (character === '/' && value[index + 1] === '*') {
      const commentEnd = value.indexOf('*/', index + 2)
      index = commentEnd === -1 ? value.length : commentEnd + 1
      continue
    }
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }

  return value.length
}

function maskCssCommentsStringsAndUrls(value) {
  let masked = ''
  for (let index = 0; index < value.length;) {
    const character = value[index]
    if (character === '/' && value[index + 1] === '*') {
      const commentEnd = value.indexOf('*/', index + 2)
      index = commentEnd === -1 ? value.length : commentEnd + 2
      masked += ' '
    } else if (character === '"' || character === "'") {
      const quote = character
      index += 1
      while (index < value.length) {
        if (value[index] === '\\') index += 2
        else if (value[index] === quote) {
          index += 1
          break
        } else index += 1
      }
      masked += ' '
    } else if (isCssUrlFunction(value, index)) {
      index = skipCssFunction(value, index + 3)
      masked += ' '
    } else {
      masked += character
      index += 1
    }
  }
  return masked
}

function containsCssHardcodedColor(declaration) {
  const value = maskCssCommentsStringsAndUrls(declaration.value)
  if (RAW_HEX_COLOR.test(value) || RAW_COLOR_FUNCTION.test(value)) return true

  const property = declaration.prop.toLowerCase()
  const customProperty = property.startsWith('--') ? property.slice(2) : ''
  const mayContainNamedColor = CSS_COLOR_PROPERTIES.has(property) ||
    /(?:^|-)color$/.test(property) ||
    (customProperty && (
      !CSS_NON_COLOR_CUSTOM_PROPERTY.test(customProperty) ||
      CSS_COLOR_CUSTOM_PROPERTY.test(customProperty)
    )) ||
    CSS_COLOR_COMPOSITION.test(value)
  return mayContainNamedColor && RAW_NAMED_COLOR.test(value)
}

function isGuardedCss(filename, root) {
  if (/(?:^|\/)src\/components\/ui\//.test(filename.replaceAll('\\', '/'))) return true

  let migrated = false
  root.walkComments((comment) => {
    if (comment.text.includes('@atelier-migrated')) migrated = true
  })
  return migrated
}

function hasCssMigrationMarker(source) {
  let quote = ''
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (isCssUrlFunction(source, index)) {
      index = skipCssFunction(source, index + 3) - 1
    } else if (character === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2)
      if (source.slice(index, commentEnd === -1 ? source.length : commentEnd + 2).includes('@atelier-migrated')) return true
      index = commentEnd === -1 ? source.length : commentEnd + 1
    }
  }
  return false
}


function cssDiagnostic(message, line, column, messageId) {
  return {
    ruleId: 'atelier/no-hardcoded-colors',
    severity: 2,
    message,
    ...(messageId ? { messageId } : {}),
    line,
    column,
  }
}

export const noHardcodedColorsCssProcessor = {
  preprocess(source, filename) {
    const messages = []
    try {
      const root = postcss.parse(source, { from: filename })
      if (isGuardedCss(filename, root)) {
        root.walkDecls((declaration) => {
          if (containsCssHardcodedColor(declaration)) {
            messages.push(cssDiagnostic(
              'Utilisez un rôle de couleur Atelier au lieu d’une couleur codée en dur.',
              declaration.source.start.line,
              declaration.source.start.column,
              'hardcodedColor',
            ))
          }
        })
      }
    } catch (error) {
      const isUiComponent = /(?:^|\/)src\/components\/ui\//.test(filename.replaceAll('\\', '/'))
      if (typeof error.line !== 'number' || typeof error.column !== 'number') throw error
      if (isUiComponent || hasCssMigrationMarker(source)) {
        messages.push(cssDiagnostic(
          `Impossible d’analyser le CSS : ${error.reason}`,
          error.line,
          error.column,
        ))
      }
    }

    cssMessagesByFilename.set(filename, messages)
    return ['']
  },
  postprocess(messageLists, filename) {
    const cssMessages = cssMessagesByFilename.get(filename) ?? []
    cssMessagesByFilename.delete(filename)
    return [...messageLists.flat(), ...cssMessages]
  },
}




function stringValues(node, sourceCode, values = [], seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return values
  seen.add(node)

  if (node.type === 'Literal' && typeof node.value === 'string') values.push(node.value)
  if (node.type === 'TemplateElement') values.push(node.value.cooked ?? node.value.raw)

  if (node.type === 'Identifier') {
    for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
      const variable = scope.set.get(node.name)
      if (!variable) continue
      const definition = variable.defs[0]
      if (variable.defs.length === 1 && definition.type === 'Variable' &&
          definition.parent?.kind === 'const' && definition.node.id.type === 'Identifier') {
        stringValues(definition.node.init, sourceCode, values, seen)
      }
      return values
    }
    return values
  }

  for (const [key, child] of Object.entries(node)) {
    if (key === 'parent') continue
    if (Array.isArray(child)) {
      for (const entry of child) {
        if (entry && typeof entry === 'object' && typeof entry.type === 'string') stringValues(entry, sourceCode, values, seen)
      }
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      stringValues(child, sourceCode, values, seen)
    }
  }

  return values
}

function containsHardcodedColor(value, className) {
  value = value.replace(/url\([^)]*\)/gi, '')
  if (RAW_HEX_COLOR.test(value) || RAW_COLOR_FUNCTION.test(value) || (!className && RAW_NAMED_COLOR.test(value))) return true
  if (!className) return false

  return value.split(/\s+/).some((classToken) => {
    const utility = classToken.slice(classToken.lastIndexOf(':') + 1).replace(/^!/, '')
    return PALETTE_UTILITY.test(utility) || ARBITRARY_NAMED_COLOR.test(utility)
  })
}

/** @type {import('eslint').Rule.RuleModule} */
const noHardcodedColors = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Interdire les couleurs codées en dur dans ui et les fichiers Atelier marqués @atelier-migrated.',
    },
    schema: [],
    messages: {
      hardcodedColor: 'Utilisez un rôle de couleur Atelier au lieu d’une couleur codée en dur.',
    },
  },
  create(context) {
    let migrated = false

    return {
      Program() {
        migrated = /(?:^|\/)src\/components\/ui\//.test(context.filename.replaceAll('\\', '/')) ||
          context.sourceCode.getAllComments().some((comment) => comment.value.includes('@atelier-migrated'))
      },
      JSXAttribute(node) {
        if (!migrated || node.name.type !== 'JSXIdentifier') return
        const attributeName = node.name.name
        if (attributeName !== 'className' && attributeName !== 'class' && attributeName !== 'style' && !COLOR_ATTRIBUTES.has(attributeName)) return

        const isClassName = attributeName === 'className' || attributeName === 'class'
        const hasHardcodedColor = stringValues(node.value, context.sourceCode).some((value) => containsHardcodedColor(value, isClassName))
        if (hasHardcodedColor) context.report({ node, messageId: 'hardcodedColor' })
      },
    }
  },
}

export default noHardcodedColors
