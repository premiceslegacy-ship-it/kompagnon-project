// Embarque un XML Factur-X dans un PDF existant.
// Le XML CII EN 16931 est accessible via /Names/EmbeddedFiles + /AF.
// Le XMP Metadata est un stream non compressé (PDFRawStream) — obligatoire pour les validateurs.

import { AFRelationship, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib'
import { FACTURX_FILENAME, FACTURX_VERSION, FACTURX_XMP_NAMESPACE, normalizeFacturxConformanceLevel } from '@/lib/pdf/facturx-profile'
import { SRGB_ICC_PROFILE_BASE64 } from '@/lib/pdf/srgb-icc'

const PDF_A_OUTPUT_INTENT = 'sRGB IEC61966-2.1'

type FacturXEmbedOptions = {
  author?: string
  conformanceLevel?: string
  creatorTool?: string
  language?: string
  producer?: string
  subject?: string
  title?: string
}

function escXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toXmpDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

function buildXmpMetadata(metadata: {
  author: string
  conformanceLevel: string
  createdAt: Date
  creatorTool: string
  producer: string
  subject: string
  title: string
  updatedAt: Date
}): string {
  const createdAt = toXmpDate(metadata.createdAt)
  const updatedAt = toXmpDate(metadata.updatedAt)

  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${escXml(metadata.creatorTool)}">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:fx="${FACTURX_XMP_NAMESPACE}">
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escXml(metadata.title)}</rdf:li>
        </rdf:Alt>
      </dc:title>
      <dc:creator>
        <rdf:Seq>
          <rdf:li>${escXml(metadata.author)}</rdf:li>
        </rdf:Seq>
      </dc:creator>
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escXml(metadata.subject)}</rdf:li>
        </rdf:Alt>
      </dc:description>
      <pdf:Producer>${escXml(metadata.producer)}</pdf:Producer>
      <xmp:CreatorTool>${escXml(metadata.creatorTool)}</xmp:CreatorTool>
      <xmp:CreateDate>${createdAt}</xmp:CreateDate>
      <xmp:ModifyDate>${updatedAt}</xmp:ModifyDate>
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${FACTURX_FILENAME}</fx:DocumentFileName>
      <fx:Version>${FACTURX_VERSION}</fx:Version>
      <fx:ConformanceLevel>${metadata.conformanceLevel}</fx:ConformanceLevel>
    </rdf:Description>

    <rdf:Description rdf:about=""
      xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
      xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
      xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>${FACTURX_XMP_NAMESPACE}</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The name of the embedded XML document</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentType</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The type of the hybrid document in capital letters, e.g. INVOICE</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>Version</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The version of the Factur-X standard</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The conformance level of the embedded XML document</pdfaProperty:description>
                </rdf:li>
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>

  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

function addOutputIntent(pdfDoc: PDFDocument): void {
  const iccProfileBytes = Buffer.from(SRGB_ICC_PROFILE_BASE64, 'base64')
  const colorProfileStream = PDFRawStream.of(
    pdfDoc.context.obj({
      Alternate: PDFName.of('DeviceRGB'),
      Length: iccProfileBytes.length,
      N: 3,
    }),
    iccProfileBytes,
  )
  const colorProfileRef = pdfDoc.context.register(colorProfileStream)

  const outputIntentRef = pdfDoc.context.register(pdfDoc.context.obj({
    DestOutputProfile: colorProfileRef,
    Info: PDFString.of(PDF_A_OUTPUT_INTENT),
    OutputConditionIdentifier: PDFString.of(PDF_A_OUTPUT_INTENT),
    S: PDFName.of('GTS_PDFA1'),
    Type: PDFName.of('OutputIntent'),
  }))

  pdfDoc.catalog.set(PDFName.of('OutputIntents'), pdfDoc.context.obj([outputIntentRef]))
}

export async function embedFacturXml(
  pdfBuffer: Buffer,
  xmlString: string,
  options: FacturXEmbedOptions = {},
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
  const now = new Date()
  const metadata = {
    author: options.author ?? pdfDoc.getAuthor() ?? '',
    conformanceLevel: normalizeFacturxConformanceLevel(options.conformanceLevel),
    createdAt: pdfDoc.getCreationDate() ?? now,
    creatorTool: options.creatorTool ?? pdfDoc.getCreator() ?? 'Kompagnon',
    producer: options.producer ?? pdfDoc.getProducer() ?? 'pdf-lib',
    subject: options.subject ?? pdfDoc.getSubject() ?? 'Facture Factur-X',
    title: options.title ?? pdfDoc.getTitle() ?? 'Facture',
    updatedAt: now,
  }

  pdfDoc.setTitle(metadata.title)
  if (metadata.author) pdfDoc.setAuthor(metadata.author)
  if (metadata.subject) pdfDoc.setSubject(metadata.subject)
  if (metadata.creatorTool) pdfDoc.setCreator(metadata.creatorTool)
  if (metadata.producer) pdfDoc.setProducer(metadata.producer)
  pdfDoc.setCreationDate(metadata.createdAt)
  pdfDoc.setModificationDate(metadata.updatedAt)
  pdfDoc.setLanguage(options.language ?? 'fr-FR')

  await pdfDoc.attach(new TextEncoder().encode(xmlString), FACTURX_FILENAME, {
    afRelationship: AFRelationship.Data,
    creationDate: metadata.createdAt,
    description: 'Factur-X XML invoice',
    mimeType: 'text/xml',
    modificationDate: metadata.updatedAt,
  })

  addOutputIntent(pdfDoc)
  pdfDoc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseAttachments'))

  // XMP Metadata — stream NON compressé (PDFRawStream obligatoire)
  const xmpString = buildXmpMetadata(metadata)
  const xmpBytes = new TextEncoder().encode(xmpString)
  const xmpDict = pdfDoc.context.obj({
    Length: xmpBytes.length,
    Subtype: PDFName.of('XML'),
    Type: PDFName.of('Metadata'),
  })
  const xmpStream = PDFRawStream.of(xmpDict, xmpBytes)
  const xmpRef = pdfDoc.context.register(xmpStream)
  pdfDoc.catalog.set(PDFName.of('Metadata'), xmpRef)

  const resultBytes = await pdfDoc.save({ useObjectStreams: false })
  return Buffer.from(resultBytes)
}
