import { describe, expect, it } from '@jest/globals'
import { importInput, parseQuestionCsv } from '../src/csv.js'
import { DomainError } from '../src/errors.js'
import { CSV_BYTE_LIMIT } from '../src/validation.js'

const header = 'Category,Question,Answer1,Answer2,Answer3,Answer4,CorrectAnswerKey'
const row = 'Fabric,What is a lakehouse?,One,Two,Three,Four,0'

describe('CSV question loading', () => {
  it('supports optional absent columns and BOM', () => {
    expect(parseQuestionCsv(`\ufeff${header}\n${row}`)).toEqual([{
      category: 'Fabric', questionText: 'What is a lakehouse?',
      answers: ['One', 'Two', 'Three', 'Four'], correctAnswerKey: 0,
      metadataRaw: undefined, pools: ['default'],
    }])
  })

  it('trims quoted commas/newlines, keeps metadata raw, and normalizes pool memberships', () => {
    const questions = parseQuestionCsv(`${header},Metadata,Pools\r\n` +
      ' Fabric ," A question,\nwith a newline ",One,Two,Three,Four,3,"{""source"":""docs""}"," Fabric, IGNITE, fabric , "\r\n')
    expect(questions[0]).toMatchObject({
      category: 'Fabric', questionText: 'A question,\nwith a newline',
      correctAnswerKey: 3, metadataRaw: '{"source":"docs"}', pools: ['fabric', 'ignite'],
    })
  })

  it('treats blank metadata and comma-only pools as missing', () => {
    expect(parseQuestionCsv(`${header},Metadata,Pools\n${row},"  ",",, "`)[0]).toMatchObject({
      metadataRaw: undefined, pools: ['default'],
    })
  })

  it.each(['-1', '4', '1.5', '1e0', '', 'nope'])('rejects invalid correct key %j', (key) => {
    expect(() => parseQuestionCsv(`${header}\nFabric,Question,A,B,C,D,${key}`)).toThrow(DomainError)
  })

  it('collects validation errors across the entire file before writing', () => {
    try {
      parseQuestionCsv(`${header}\n,Question,A,B,C,D,0\nFabric,,A,,C,D,8`)
      throw new Error('Expected invalid CSV')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(DomainError)
      if (!(error instanceof DomainError)) throw error
      expect(error.validationErrors).toEqual(expect.arrayContaining([
        { row: 2, message: 'Category is required.' },
        { row: 3, message: 'Question is required.' },
        { row: 3, message: 'Answer2 is required.' },
        { row: 3, message: 'CorrectAnswerKey must be an integer between 0 and 3.' },
      ]))
    }
  })

  it.each([
    '', header, `${header}\n"unterminated`, `Question,Answer1\nQuestion,A`,
    `${header},Category\n${row},Fabric`, `${header}\n${row},extra`,
  ])('rejects empty, malformed, missing, duplicate or mismatched columns', (csv) => {
    expect(() => parseQuestionCsv(csv)).toThrow(DomainError)
  })

  it('bounds fields in UTF-16 units including metadata, but allows 4000 characters', () => {
    expect(parseQuestionCsv(`${header},Metadata\n${row},${'x'.repeat(4000)}`)[0].metadataRaw).toHaveLength(4000)
    expect(() => parseQuestionCsv(`${header},Metadata\n${row},${'x'.repeat(4001)}`)).toThrow(DomainError)
    expect(() => parseQuestionCsv(`${header}\nFabric,${'😀'.repeat(2001)},A,B,C,D,0`)).toThrow(DomainError)
    expect(() => parseQuestionCsv(`${header},Pools\n${row},${'a'.repeat(401)}`)).toThrow(DomainError)
  })

  it('keeps duplicate answer labels valid', () => {
    expect(parseQuestionCsv(`${header}\nFabric,Question,Same,Same,Same,Same,2`)[0].answers)
      .toEqual(['Same', 'Same', 'Same', 'Same'])
  })

  it('enforces the upload byte limit using UTF-8 bytes, not JS character count', () => {
    expect(() => parseQuestionCsv('é'.repeat(CSV_BYTE_LIMIT / 2 + 1))).toThrow('10 MiB')
  })

  it('hashes identical imports consistently without making separate import IDs duplicates', () => {
    const csv = `${header}\n${row}`
    const first = importInput({ importId: '11111111-1111-4111-8111-111111111111', csv })
    const second = importInput({ importId: '22222222-2222-4222-8222-222222222222', csv })
    expect(first.contentHash).toBe(second.contentHash)
    expect(first.importId).not.toBe(second.importId)
    expect(importInput({ importId: first.importId, csv: csv + '\n' }).contentHash).not.toBe(first.contentHash)
  })
})
