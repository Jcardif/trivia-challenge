import { createHash } from 'node:crypto'
import { parse } from 'csv-parse/sync'
import { DomainError } from './errors.js'
import { CSV_BYTE_LIMIT, record, SLUG_LIMIT, TEXT_LIMIT, uuid } from './validation.js'

export interface ImportedQuestion {
  category: string
  questionText: string
  answers: [string, string, string, string]
  correctAnswerKey: number
  metadataRaw?: string
  pools: string[]
}

export interface ValidatedImport {
  importId: string
  contentHash: string
  questions: ImportedQuestion[]
}

const requiredColumns = ['Category', 'Question', 'Answer1', 'Answer2', 'Answer3', 'Answer4', 'CorrectAnswerKey']

export function parseQuestionCsv(csv: string): ImportedQuestion[] {
  if (!csv.trim()) throw new DomainError('VALIDATION_ERROR', 'CSV file is required.')
  if (Buffer.byteLength(csv, 'utf8') > CSV_BYTE_LIMIT) {
    throw new DomainError('VALIDATION_ERROR', 'CSV file exceeds the 10 MiB limit.')
  }
  let parsed: unknown
  try {
    parsed = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    })
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error
    const row = 'lines' in error && typeof error.lines === 'number' ? error.lines : 1
    throw new DomainError('VALIDATION_ERROR', 'Invalid CSV format.', false, [{ row, message: error.message }])
  }
  if (!Array.isArray(parsed) || !parsed.every((row: unknown) =>
    Array.isArray(row) && row.every((cell: unknown) => typeof cell === 'string'))) {
    throw new Error('CSV parser returned an unexpected record shape.')
  }
  const rows = parsed as string[][]
  const headers = rows[0]?.map((cell) => cell.trim()) ?? []
  const missing = requiredColumns.filter((column) => !headers.includes(column))
  if (missing.length || new Set(headers).size !== headers.length) {
    throw new DomainError('VALIDATION_ERROR', 'CSV headers are invalid.', false, [{
      row: 1,
      message: missing.length ? `Missing columns: ${missing.join(', ')}.` : 'Duplicate column names are not allowed.',
    }])
  }
  const errors: Array<{ row: number; message: string }> = []
  const questions: ImportedQuestion[] = []
  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i]
    const row = i + 1
    if (cells.length !== headers.length) {
      errors.push({ row, message: `Expected ${headers.length} columns, found ${cells.length}.` })
    }
    const cell = (column: string): string => cells[headers.indexOf(column)]?.trim() ?? ''
    const bounded = (column: string, required: boolean): string => {
      const value = cell(column)
      if (required && !value) errors.push({ row, message: `${column} is required.` })
      if (value.length > TEXT_LIMIT) {
        errors.push({ row, message: `${column} must be at most ${TEXT_LIMIT} UTF-16 code units.` })
      }
      return value
    }
    const keyCell = cell('CorrectAnswerKey')
    const key = Number(keyCell)
    if (!/^[+-]?\d+$/.test(keyCell) || !Number.isInteger(key) || key < 0 || key > 3) {
      errors.push({ row, message: 'CorrectAnswerKey must be an integer between 0 and 3.' })
    }
    const pools = [...new Set(cell('Pools').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))]
    if (pools.some((value) => value.length > SLUG_LIMIT)) {
      errors.push({ row, message: `Each pool slug must be at most ${SLUG_LIMIT} UTF-16 code units.` })
    }
    questions.push({
      category: bounded('Category', true),
      questionText: bounded('Question', true),
      answers: [
        bounded('Answer1', true), bounded('Answer2', true),
        bounded('Answer3', true), bounded('Answer4', true),
      ],
      correctAnswerKey: key,
      metadataRaw: bounded('Metadata', false) || undefined,
      pools: pools.length ? pools : ['default'],
    })
  }
  if (errors.length) throw new DomainError('VALIDATION_ERROR', 'CSV validation failed.', false, errors)
  if (!questions.length) throw new DomainError('VALIDATION_ERROR', 'No questions found in the CSV file.')
  return questions
}

export function importInput(value: unknown): ValidatedImport {
  const input = record(value)
  const importId = uuid(input.importId, 'importId')
  if (typeof input.csv !== 'string') throw new DomainError('VALIDATION_ERROR', 'csv must be a string.')
  const questions = parseQuestionCsv(input.csv)
  return {
    importId,
    contentHash: createHash('sha256').update(input.csv, 'utf8').digest('hex'),
    questions,
  }
}
