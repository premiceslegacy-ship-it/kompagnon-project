// Embarque un XML Factur-X dans un PDF existant pour produire un PDF/A-3 conforme.
// Spécification : Factur-X 1.0, PDF/A-3b, XMP namespace urn:factur-x:pdfa:CrossIndustryInvoiceType

import { PDFDocument, PDFName, PDFDict, PDFStream, PDFHexString, PDFArray, PDFString } from 'pdf-lib'

const FACTURX_FILENAME = 'factur-x.xml'
const FACTURX_CONFORMANCE = 'EN16931'
const FACTURX_VERSION = '1.0'

// XMP Metadata complet avec namespace Factur-X
function buildXmpMetadata(conformanceLevel: string): string {
  const now = new Date().toISOString()
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">

    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
      xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
      xmlns:fx="urn:factur-x:pdfa:CrossIndustryInvoiceType">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${FACTURX_FILENAME}</fx:DocumentFileName>
      <fx:Version>${FACTURX_VERSION}</fx:Version>
      <fx:ConformanceLevel>${conformanceLevel}</fx:ConformanceLevel>
      <xmp:ModifyDate>${now}</xmp:ModifyDate>
      <xmp:CreateDate>${now}</xmp:CreateDate>
    </rdf:Description>

    <rdf:Description rdf:about=""
      xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
      xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
      xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryInvoiceType</pdfaSchema:namespaceURI>
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
                  <pdfaProperty:description>The type of the hybrid document</pdfaProperty:description>
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

export async function embedFacturXml(
  pdfBuffer: Buffer,
  xmlString: string,
  conformanceLevel = FACTURX_CONFORMANCE,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
  const context = pdfDoc.context
  const catalog = pdfDoc.catalog

  const xmlBytes = new TextEncoder().encode(xmlString)

  // Créer le stream du fichier XML embarqué
  const xmlStream = context.flateStream(xmlBytes, {
    Type: 'EmbeddedFile',
    Subtype: 'text/xml',
    Params: context.obj({
      Size: xmlBytes.length,
      ModDate: PDFString.of(new Date().toISOString()),
    }),
  })
  const xmlStreamRef = context.register(xmlStream)

  // FileSpec dict — décrit le fichier attaché
  const fileSpecDict = context.obj({
    Type: 'Filespec',
    F: PDFString.of(FACTURX_FILENAME),
    UF: PDFString.of(FACTURX_FILENAME),
    EF: context.obj({ F: xmlStreamRef, UF: xmlStreamRef }),
    Desc: PDFString.of('Factur-X XML invoice'),
    // AFRelationship obligatoire pour PDF/A-3 associated files
    AFRelationship: PDFName.of('Data'),
  })
  const fileSpecRef = context.register(fileSpecDict)

  // /Names → /EmbeddedFiles dans le catalog
  const embeddedFilesDict = context.obj({
    Names: [PDFString.of(FACTURX_FILENAME), fileSpecRef],
  })
  const namesDict = context.obj({ EmbeddedFiles: embeddedFilesDict })
  catalog.set(PDFName.of('Names'), namesDict)

  // AF (Associated Files) — requis PDF/A-3 pour associer le XML à la page
  const afArray = context.obj([fileSpecRef])
  catalog.set(PDFName.of('AF'), afArray)

  // XMP Metadata
  const xmpString = buildXmpMetadata(conformanceLevel)
  const xmpBytes = new TextEncoder().encode(xmpString)
  const xmpStream = context.flateStream(xmpBytes, {
    Type: 'Metadata',
    Subtype: 'XML',
  })
  const xmpRef = context.register(xmpStream)
  catalog.set(PDFName.of('Metadata'), xmpRef)

  const resultBytes = await pdfDoc.save()
  return Buffer.from(resultBytes)
}
