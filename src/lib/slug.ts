import { customAlphabet } from 'nanoid'

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const generate = customAlphabet(alphabet, 7)

export function generateSlug(length = 7): string {
  return generate(length)
}
