import { describe, expect, it } from 'vitest'
import { onlyPdfs, urlFromText, urlFromUriList } from './pasteImport.ts'

describe('urlFromText', () => {
  it('accepts a single http(s) address', () => {
    expect(urlFromText(' https://example.de/a?b=1 ')).toBe('https://example.de/a?b=1')
  })

  it('rejects other text, several words and other schemes', () => {
    expect(urlFromText('siehe https://example.de')).toBeNull()
    expect(urlFromText('Einkaufsliste')).toBeNull()
    expect(urlFromText('javascript:alert(1)')).toBeNull()
    expect(urlFromText('ftp://example.de/x')).toBeNull()
    expect(urlFromText('')).toBeNull()
  })
})

describe('urlFromUriList', () => {
  it('takes the first address and skips comments', () => {
    expect(urlFromUriList('# from a browser\r\nhttps://example.de/x\r\nhttps://example.de/y')).toBe(
      'https://example.de/x',
    )
    expect(urlFromUriList('# nothing')).toBeNull()
  })
})

describe('onlyPdfs', () => {
  const file = (name: string, type: string) => new File(['x'], name, { type })

  it('returns the files only if all are PDFs', () => {
    const pdf = file('a.pdf', 'application/pdf')
    expect(onlyPdfs([pdf, file('B.PDF', '')])).toHaveLength(2)
    expect(onlyPdfs([pdf, file('b.png', 'image/png')])).toBeNull()
    expect(onlyPdfs([])).toBeNull()
  })
})
