const PALETTE = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)'
const COLOR_PREFIX = '(?:bg|text|border(?:-[trblsexy])?|divide|ring|ring-offset|outline|shadow|fill|stroke|decoration|accent|caret|placeholder|from|via|to)'
const PALETTE_UTILITY = new RegExp(`^${COLOR_PREFIX}-${PALETTE}(?:-(?:50|100|200|300|400|500|600|700|800|900|950))?(?:/(?:\\d{1,3}|\\[[^\\]]+\\]))?$`, 'i')
const RAW_HEX_COLOR = /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b/i
const RAW_COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?!var\(--|from\s+var\(--)/i
const CSS_NAMED_COLORS = '(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)'
const RAW_NAMED_COLOR = new RegExp(`(?:^|[\\s,(])${CSS_NAMED_COLORS}(?=$|[\\s),/])`, 'i')
const ARBITRARY_NAMED_COLOR = new RegExp(`^${COLOR_PREFIX}-\\[${CSS_NAMED_COLORS}\\]$`, 'i')
const COLOR_ATTRIBUTES = new Set(['color', 'fill', 'stroke', 'stopColor', 'floodColor', 'lightingColor'])


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
      description: 'Interdire les couleurs codées en dur dans les fichiers Atelier migrés, opt-in via le commentaire @atelier-migrated.',
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
        migrated = context.sourceCode.getAllComments().some((comment) => comment.value.includes('@atelier-migrated'))
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
