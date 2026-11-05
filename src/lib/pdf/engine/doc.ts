import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFFont, PDFPage } from 'pdf-lib'
import { PAGE } from './theme'
import type { FontBytes } from './fonts'

export type Fonts = {
  /** Inter Regular : texte courant. */
  regular: PDFFont
  /** Inter Bold : valeurs et libellés appuyés dans le texte. */
  bold: PDFFont
  /** Geist Sans Bold : titres. */
  heading: PDFFont
  /** Geist Sans Bold (alias historique de `heading`). */
  headingXBold: PDFFont
  /** Geist Sans Medium : intitulé du document, plus petit et non gras. */
  title: PDFFont
}

export type PageHook = (ctx: { page: PDFPage; pageIndex: number }) => number // retourne le y de départ du contenu
export type FinishHook = (ctx: { page: PDFPage; pageIndex: number; pageCount: number }) => void

export class PdfDoc {
  doc: PDFDocument
  fonts: Fonts
  page!: PDFPage
  y = 0
  private pages: PDFPage[] = []
  onNewPage?: PageHook
  onFinishPage?: FinishHook
  /** Limite basse du contenu (au-dessus du pied de page). Réglée par le gabarit. */
  bottomLimit: number = PAGE.footerHeight

  private constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc
    this.fonts = fonts
  }

  static async create(fontBytes: FontBytes): Promise<PdfDoc> {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const [regular, bold, heading, title] = await Promise.all([
      doc.embedFont(fontBytes.interRegular, { subset: true }),
      doc.embedFont(fontBytes.interBold, { subset: true }),
      doc.embedFont(fontBytes.geistBold, { subset: true }),
      doc.embedFont(fontBytes.geistMedium, { subset: true }),
    ])
    return new PdfDoc(doc, { regular, bold, heading, headingXBold: heading, title })
  }

  addPage(): PDFPage {
    const page = this.doc.addPage([PAGE.width, PAGE.height])
    this.pages.push(page)
    this.page = page
    const startY = this.onNewPage
      ? this.onNewPage({ page, pageIndex: this.pages.length - 1 })
      : PAGE.height - PAGE.headerTop
    this.y = startY
    return page
  }

  /** Réserve `height` de hauteur ; saute de page si ça ne rentre pas. */
  ensureSpace(height: number): void {
    if (this.y - height < this.bottomLimit) {
      this.addPage()
    }
  }

  get pageCount(): number {
    return this.pages.length
  }

  /** Place un bloc de `height` en bas de la page courante, juste au-dessus du pied (saute de page s'il ne tient pas). */
  pinToBottom(height: number): void {
    if (this.y - height < this.bottomLimit) this.addPage()
    this.y = this.bottomLimit + height
  }

  moveDown(gap: number): void {
    this.y -= gap
  }

  /** Exécute le hook de fin de page sur toutes les pages (footer paginé "X/Y"), puis sauvegarde. */
  async save(): Promise<Buffer> {
    if (this.onFinishPage) {
      const pageCount = this.pages.length
      this.pages.forEach((page, pageIndex) => {
        this.onFinishPage!({ page, pageIndex, pageCount })
      })
    }
    const bytes = await this.doc.save({ useObjectStreams: false })
    return Buffer.from(bytes)
  }
}
