export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: (string | number)[]
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_RE.exec(version.trim())
  if (!match) return null
  const [, major, minor, patch, prerelease] = match
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ? prerelease.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [],
  }
}

export function isValidVersion(version: string): boolean {
  return parseVersion(version) !== null
}

function comparePrerelease(a: (string | number)[], b: (string | number)[]): number {
  // No prerelease identifiers outranks having them (1.0.0 > 1.0.0-beta).
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1

  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i]
    const bi = b[i]
    if (ai === undefined) return -1
    if (bi === undefined) return 1
    if (typeof ai === 'number' && typeof bi === 'number') {
      if (ai !== bi) return ai < bi ? -1 : 1
      continue
    }
    if (typeof ai === 'number') return -1
    if (typeof bi === 'number') return 1
    if (ai !== bi) return ai < bi ? -1 : 1
  }
  return 0
}

/**
 * Proper (non-string) semantic version comparison: 1.10.0 > 1.9.0. Returns
 * -1/0/1. An unparsable version is always treated as older than any
 * parsable one — see isValidVersion for the guard callers should use before
 * trusting a comparison for anything security- or availability-sensitive
 * (e.g. remote config values that could otherwise force-update everyone).
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return comparePrerelease(pa.prerelease, pb.prerelease)
}

export function isVersionLessThan(a: string, b: string): boolean {
  return compareVersions(a, b) < 0
}

export function isVersionAtLeast(a: string, b: string): boolean {
  return compareVersions(a, b) >= 0
}
