let counter = 0

export function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter.toString(36)}`
}

// Decimal, matching src/lib/format.ts — see the comment there for why.
export const GB = 1000 ** 3
export const MB = 1000 ** 2

export function gb(value: number): number {
  return Math.round(value * GB)
}

export function mb(value: number): number {
  return Math.round(value * MB)
}
